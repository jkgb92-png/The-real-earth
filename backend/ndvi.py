"""
backend/ndvi.py

Vegetation Health (NDVI) tile endpoint.

Computes the Normalised Difference Vegetation Index per-pixel from the same
multi-band Sentinel-2 GeoTIFFs used by the cloud-free compositor:

    NDVI = (NIR - Red) / (NIR + Red)

where NIR = band index 3 and Red = band index 0 in standard Sentinel-2 band
ordering (B02-Red, B03-Green, B04-Blue, B08-NIR).

The resulting float32 NDVI grid (range -1 to +1) is mapped to a fixed colour
ramp and encoded as PNG or WebP.

Colour ramp (-1 to +1)
-----------------------
  < 0.0   Dark blue-grey  (water / built-up)
  0.0-0.1 Tan / beige     (bare soil / sand)
  0.1-0.3 Yellow-green    (sparse / stressed vegetation)
  0.3-0.6 Medium green    (moderate vegetation)
  0.6-1.0 Dark green      (dense / healthy vegetation)

Public API
----------
  get_ndvi_tile(z, x, y, passes, accept) -> fastapi.Response
    Called directly from tile_server.py at GET /tiles/ndvi/{z}/{x}/{y}.
"""

from __future__ import annotations

import io
import warnings
from pathlib import Path

import numpy as np
from fastapi import Response
from PIL import Image

from .compositing import load_tile_as_array
from .config import Settings

settings = Settings()

TILE_STORE = Path(settings.tile_store_path)

# ---------------------------------------------------------------------------
# NDVI colour ramp -- 256 entries mapping index 0 (NDVI ~ -1) to 255 (NDVI ~ +1)
# ---------------------------------------------------------------------------

def _build_ndvi_ramp() -> np.ndarray:
    """Return a (256, 3) uint8 colour ramp for NDVI visualisation."""
    ramp = np.zeros((256, 3), dtype=np.uint8)
    # Colour stops: (t_start, t_end, rgb_start, rgb_end)
    stops = [
        (0.000, 0.375, (20,  50, 110), (200, 165,  90)),   # water -> bare soil
        (0.375, 0.500, (200, 165,  90), (225, 210,  55)),   # bare soil -> yellow
        (0.500, 0.600, (225, 210,  55), (120, 175,  35)),   # yellow -> light green
        (0.600, 0.750, (120, 175,  35), ( 40, 130,  20)),   # light green -> medium green
        (0.750, 1.000, ( 40, 130,  20), (  0,  75,   5)),   # medium green -> dark green
    ]
    for t0, t1, c0, c1 in stops:
        i0 = int(t0 * 255)
        i1 = int(t1 * 255)
        if i1 <= i0:
            continue
        for i in range(i0, i1 + 1):
            t = (i - i0) / (i1 - i0)
            ramp[i] = (
                int(c0[0] + t * (c1[0] - c0[0])),
                int(c0[1] + t * (c1[1] - c0[1])),
                int(c0[2] + t * (c1[2] - c0[2])),
            )
    return ramp


_NDVI_RAMP: np.ndarray = _build_ndvi_ramp()


# ---------------------------------------------------------------------------
# NDVI computation helpers
# ---------------------------------------------------------------------------

def compute_ndvi(tile_paths: list[str]) -> np.ndarray:
    """
    Compute a per-pixel mean NDVI from multiple GeoTIFF passes.

    Returns a (H, W) float32 array in the range [-1, +1].
    Pixels where NIR + Red == 0 are set to 0 (neutral).
    """
    ndvi_stack: list[np.ndarray] = []

    for path in tile_paths:
        arr = load_tile_as_array(path)            # (bands, H, W)
        if arr.shape[0] < 4:
            # Single-band or RGB-only tile: skip (no NIR band)
            continue
        red = arr[0].astype(np.float32)
        nir = arr[3].astype(np.float32)
        denom = nir + red
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            ndvi = np.where(denom > 0, (nir - red) / denom, 0.0)
        ndvi_stack.append(ndvi)

    if not ndvi_stack:
        raise ValueError("No valid tile passes with NIR band found")

    # Mean NDVI across all passes
    volume = np.stack(ndvi_stack, axis=0)         # (N, H, W)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(volume, axis=0).astype(np.float32)


def ndvi_to_image(ndvi: np.ndarray) -> np.ndarray:
    """
    Map a (H, W) float32 NDVI array to a (H, W, 3) uint8 RGB image using
    the fixed colour ramp.
    """
    # Normalise [-1, +1] -> [0, 255]
    indices = np.clip(((ndvi + 1.0) / 2.0 * 255.0).astype(np.int32), 0, 255)
    return _NDVI_RAMP[indices]                    # (H, W, 3)


def ndvi_to_png(ndvi: np.ndarray) -> bytes:
    img = Image.fromarray(ndvi_to_image(ndvi))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def ndvi_to_webp(ndvi: np.ndarray) -> bytes:
    img = Image.fromarray(ndvi_to_image(ndvi))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tile handler -- called directly from tile_server.py
# ---------------------------------------------------------------------------

async def get_ndvi_tile(
    z: int,
    x: int,
    y: int,
    passes: int = 8,
    accept: str = "",
) -> Response:
    """
    Returns a colourised NDVI tile at the requested (z, x, y).

    The NDVI is computed as the mean of up to ``passes`` GeoTIFF acquisitions
    stored under TILE_STORE/{z}/{x}/{y}/.

    Responds with image/webp when ``accept`` contains "image/webp".
    Returns 404 when no valid pass with a NIR band is available.
    """
    if z < 10:
        return Response(status_code=404, content="NDVI tiles only available at z>=10")

    # Explicit integer bounds check on tile coordinates before any path operation.
    # FastAPI already enforces ge=0 / le=25 on z, but we re-validate here so
    # CodeQL can track the sanitisation and x/y are bounded by the tile grid.
    max_coord = 2 ** z - 1
    if x < 0 or x > max_coord or y < 0 or y > max_coord:
        return Response(status_code=400, content="Invalid tile coordinates")

    tile_dir = TILE_STORE / str(z) / str(x) / str(y)
    # Path traversal guard -- ensure tile_dir stays inside TILE_STORE
    try:
        tile_dir = tile_dir.resolve()
        tile_dir.relative_to(TILE_STORE.resolve())
    except (ValueError, OSError):
        return Response(status_code=400, content="Invalid tile coordinates")

    tile_paths = sorted(tile_dir.glob("*.tif"))[:passes]

    if len(tile_paths) < 1:
        return Response(status_code=404, content="No tile passes available")

    try:
        ndvi = compute_ndvi([str(p) for p in tile_paths])
    except ValueError:
        return Response(status_code=404, content="No valid tile data found")

    if "image/webp" in accept:
        return Response(content=ndvi_to_webp(ndvi), media_type="image/webp")
    return Response(content=ndvi_to_png(ndvi), media_type="image/png")
