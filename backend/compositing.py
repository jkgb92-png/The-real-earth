"""
backend/compositing.py

Cloud-free satellite tile compositing via temporal median pixel stacking.

For each requested tile (z/x/y), we expect the tile store to contain multiple
GeoTIFF passes acquired on different dates:

    tiles/<z>/<x>/<y>/
        2024-01-03.tif
        2024-01-15.tif
        ...

Algorithm
---------
1. Load N passes for the tile.
2. For each pass, derive a cloud mask from the NIR band (high reflectance ≈ cloud).
3. Set cloud pixels to NaN.
4. Stack all passes into a (N, bands, H, W) array.
5. nanmedian along axis=0 → cloud pixels are ignored; ground pixels persist.
6. Fallback: where ALL passes are cloudy, substitute the raw mean.
7. Convert to 8-bit RGB and serve as PNG or WebP.
"""

from __future__ import annotations

import io
import os
import warnings
from pathlib import Path
from typing import List

import numpy as np
import rasterio
from fastapi import FastAPI, Query, Response
from PIL import Image

from .config import Settings

settings = Settings()
app = FastAPI(title="Earth Observation Compositing API")

TILE_STORE = Path(settings.tile_store_path)


# ---------------------------------------------------------------------------
# Core compositing helpers
# ---------------------------------------------------------------------------

def load_tile_as_array(path: str) -> np.ndarray:
    """Load a GeoTIFF tile and return a (bands, H, W) float32 array."""
    with rasterio.open(path) as src:
        return src.read().astype(np.float32)


def cloud_mask_from_band(arr: np.ndarray, threshold: float = 0.9) -> np.ndarray:
    """
    Simple NIR-reflectance cloud mask.

    Returns a (H, W) bool mask where True = cloud / bright pixel.
    Uses band index 3 (NIR) when available, otherwise falls back to band 0.
    """
    nir = arr[3] if arr.shape[0] > 3 else arr[0]
    band_max = nir.max()
    if band_max == 0:
        return np.zeros(nir.shape, dtype=bool)
    return nir > (threshold * band_max)


def median_composite(tile_paths: List[str]) -> np.ndarray:
    """
    Stack N GeoTIFF passes, mask clouds, and return a (bands, H, W) uint16
    median composite ready to encode as an image.
    """
    tile_arrays: list[np.ndarray] = []
    for path in tile_paths:
        arr = load_tile_as_array(path)
        mask = cloud_mask_from_band(arr)          # (H, W) bool
        arr[:, mask] = np.nan                     # mask cloud pixels
        tile_arrays.append(arr)

    # volume shape: (N, bands, H, W)
    volume = np.stack(tile_arrays, axis=0)

    # Primary composite: nanmedian ignores NaN (cloud) pixels
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        composite = np.nanmedian(volume, axis=0)      # (bands, H, W)

    # Fallback: pixels that are cloudy in ALL passes → use raw mean instead
    all_cloudy = np.all(np.isnan(volume), axis=0)  # (bands, H, W)
    if all_cloudy.any():
        raw_arrays = [load_tile_as_array(p) for p in tile_paths]
        raw_mean = np.nanmean(np.stack(raw_arrays, axis=0), axis=0)
        composite[all_cloudy] = raw_mean[all_cloudy]

    return np.clip(composite, 0, 65535).astype(np.uint16)


def composite_to_webp(composite: np.ndarray) -> bytes:
    """Convert (bands, H, W) uint16 composite to WebP bytes."""
    rgb = (composite[:3] / 256).astype(np.uint8)
    img = Image.fromarray(np.moveaxis(rgb, 0, -1))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85)
    return buf.getvalue()


def composite_to_png(composite: np.ndarray) -> bytes:
    """Convert (bands, H, W) uint16 composite to PNG bytes."""
    rgb = (composite[:3] / 256).astype(np.uint8)
    img = Image.fromarray(np.moveaxis(rgb, 0, -1))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------

@app.get(
    "/composite-tile/{z}/{x}/{y}.png",
    summary="Cloud-free composite tile (PNG)",
    response_class=Response,
)
async def get_composite_tile(
    z: int,
    x: int,
    y: int,
    passes: int = Query(default=8, ge=3, le=30, description="Number of satellite passes to composite"),
    accept: str = "",
) -> Response:
    """
    Returns a cloud-free PNG (or WebP) tile at the requested (z, x, y) using
    temporal median compositing over the last ``passes`` GeoTIFF acquisitions.

    Serve WebP when the client sends ``Accept: image/webp`` for ~35% smaller
    payloads on supported browsers and the Mapbox SDK.
    """
    tile_dir = TILE_STORE / str(z) / str(x) / str(y)
    # Resolve and ensure the path stays inside TILE_STORE (prevents path traversal)
    try:
        tile_dir = tile_dir.resolve()
        tile_store_resolved = TILE_STORE.resolve()
        tile_dir.relative_to(tile_store_resolved)
    except (ValueError, OSError):
        return Response(status_code=400, content="Invalid tile coordinates")
    tile_paths = sorted(tile_dir.glob("*.tif"))[:passes]

    if len(tile_paths) < 2:
        return Response(status_code=404, content="Not enough tile passes available")

    composite = median_composite([str(p) for p in tile_paths])

    want_webp = "image/webp" in accept
    if want_webp:
        return Response(content=composite_to_webp(composite), media_type="image/webp")
    return Response(content=composite_to_png(composite), media_type="image/png")
