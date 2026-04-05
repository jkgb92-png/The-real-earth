"""
backend/sar_reconstruct/model.py

SAR-to-Optical Image Translation endpoint.

When every satellite pass for a tile is cloud-covered (persistent cloud cover),
we fall back to Sentinel-1 SAR data.  SAR is radar-based and therefore
completely cloud-independent.  A pix2pix / CycleGAN model trained on paired
SAR+optical patches reconstructs what the ground surface looks like optically.

The model is stored as a TorchScript artifact (model.pt) so no training code
is needed at inference time.

This endpoint is guarded behind a feature flag (SAR_FEATURE_ENABLED=true).

Endpoint
--------
POST /sar-reconstruct
    Body: multipart/form-data  { sar_tile: <GeoTIFF binary> }
    Returns: image/png  (reconstructed optical tile, 256×256 px)
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image

from ..config import Settings

settings = Settings()
sar_app = FastAPI(title="SAR-to-Optical Reconstruction")

_model: torch.nn.Module | None = None


def _load_model() -> torch.nn.Module:
    """Lazy-load the TorchScript model on first request."""
    global _model
    if _model is None:
        model_path = Path(settings.sar_model_path)
        if not model_path.exists():
            raise RuntimeError(
                f"SAR model not found at {model_path}. "
                "Set SAR_MODEL_PATH to the correct path."
            )
        _model = torch.jit.load(str(model_path), map_location="cpu")
        _model.eval()
    return _model


def sar_to_optical(sar_array: np.ndarray) -> np.ndarray:
    """
    Run a (1, H, W) float32 SAR array through the pix2pix model.

    Returns a (3, H, W) uint8 array (RGB optical reconstruction).
    """
    model = _load_model()
    # Normalise SAR to [-1, 1]
    sar_min, sar_max = sar_array.min(), sar_array.max()
    if sar_max > sar_min:
        norm = (sar_array - sar_min) / (sar_max - sar_min) * 2.0 - 1.0
    else:
        norm = np.zeros_like(sar_array)

    tensor = torch.from_numpy(norm[np.newaxis]).float()  # (1, 1, H, W)
    with torch.no_grad():
        out = model(tensor)  # expected (1, 3, H, W) in [-1, 1]

    # Denormalise to [0, 255]
    rgb = ((out.squeeze(0).numpy() + 1.0) / 2.0 * 255).clip(0, 255).astype(np.uint8)
    return rgb  # (3, H, W)


@sar_app.post(
    "/sar-reconstruct",
    summary="Reconstruct optical tile from SAR data",
    response_class=Response,
)
async def reconstruct(sar_tile: UploadFile = File(...)) -> Response:
    """
    Accepts a single-band Sentinel-1 SAR GeoTIFF and returns a synthetic
    optical PNG tile via the trained pix2pix translation model.
    """
    if not settings.sar_feature_enabled:
        raise HTTPException(status_code=501, detail="SAR reconstruction is not enabled")

    import rasterio

    raw = await sar_tile.read()
    with rasterio.open(io.BytesIO(raw)) as src:
        sar_data = src.read(1).astype(np.float32)  # (H, W)

    rgb = sar_to_optical(sar_data[np.newaxis])  # (3, H, W)
    img = Image.fromarray(np.moveaxis(rgb, 0, -1))  # (H, W, 3)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return Response(content=buf.getvalue(), media_type="image/png")
