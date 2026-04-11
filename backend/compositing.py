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


def normalize_composite(
    composite: np.ndarray,
    p_low: float = 2.0,
    p_high: float = 98.0,
) -> np.ndarray:
    """
    Apply a shared percentile stretch to the first three (RGB) bands of a
    (bands, H, W) uint16 array.

    A single [p_low, p_high] percentile range is computed from ALL valid pixels
    across the three RGB bands combined, then applied equally to each band.
    This preserves relative colour balance — independent per-band stretching
    amplifies whichever channel has the narrowest dynamic range (e.g. green
    over saline water), causing visible hue shifts and tile-boundary seams at
    high zoom levels.  Bands beyond index 2 (e.g. NIR) are passed through
    unchanged.
    """
    result = composite.copy()
    n_rgb = min(3, composite.shape[0])

    # Gather all valid (non-zero) pixels from the RGB bands to derive a single
    # shared stretch range that keeps the inter-band ratios intact.
    rgb = composite[:n_rgb].astype(np.float32)
    valid_all = rgb[rgb > 0]
    if valid_all.size == 0:
        return result
    lo = float(np.percentile(valid_all, p_low))
    hi = float(np.percentile(valid_all, p_high))
    if hi <= lo:
        return result

    for b in range(n_rgb):
        band = composite[b].astype(np.float32)
        result[b] = np.clip((band - lo) / (hi - lo) * 65535.0, 0.0, 65535.0).astype(np.uint16)
    return result


def composite_to_webp(composite: np.ndarray) -> bytes:
    """Convert (bands, H, W) uint16 composite to WebP bytes."""
    normalized = normalize_composite(composite)
    rgb = (normalized[:3] / 256).astype(np.uint8)
    img = Image.fromarray(np.moveaxis(rgb, 0, -1))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=90)
    return buf.getvalue()


def composite_to_png(composite: np.ndarray) -> bytes:
    """Convert (bands, H, W) uint16 composite to PNG bytes."""
    normalized = normalize_composite(composite)
    rgb = (normalized[:3] / 256).astype(np.uint8)
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
    year: int | None = None,
) -> Response:
    """
    Returns a cloud-free PNG (or WebP) tile at the requested (z, x, y) using
    temporal median compositing over the last ``passes`` GeoTIFF acquisitions.

    When ``year`` is provided, only passes whose filename starts with that
    four-digit year prefix are composited.  This powers the Time-Machine Swipe
    Compare feature (historical vs. current imagery).

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

    all_paths = sorted(tile_dir.glob("*.tif"))

    # Filter by year prefix when requested (e.g. "2024-01-03.tif" starts with "2024")
    if year is not None:
        year_prefix = str(year)
        all_paths = [p for p in all_paths if p.name.startswith(year_prefix)]

    tile_paths = all_paths[:passes]

    if len(tile_paths) < 2:
        return Response(status_code=404, content="Not enough tile passes available")

    composite = median_composite([str(p) for p in tile_paths])

    want_webp = "image/webp" in accept
    if want_webp:
        return Response(content=composite_to_webp(composite), media_type="image/webp")
    return Response(content=composite_to_png(composite), media_type="image/png")
