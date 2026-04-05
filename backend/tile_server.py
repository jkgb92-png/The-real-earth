"""
backend/tile_server.py

WMTS/TMS tile delivery gateway (FastAPI).

Responsibilities
----------------
- Proxy NASA GIBS WMTS as the base Blue-Marble layer.
- Serve locally composited Sentinel-2 tiles for high-zoom requests (z ≥ 10).
- Accept ``Accept: image/webp`` for compressed delivery.
- Mount the compositing router so both services share one process.

Run with:
    uvicorn backend.tile_server:app --reload --port 8000
"""

from __future__ import annotations

import httpx
from fastapi import FastAPI, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .compositing import app as compositing_app, get_composite_tile
from .config import Settings

settings = Settings()

app = FastAPI(title="The Real Earth — Tile Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Mount the compositing sub-application under /compositing
app.mount("/compositing", compositing_app)

# ---------------------------------------------------------------------------
# NASA GIBS proxy — base Blue Marble layer
# ---------------------------------------------------------------------------

GIBS_LAYER = "BlueMarble_NextGeneration"
GIBS_MATRIX_SET = "GoogleMapsCompatible_Level8"
GIBS_FORMAT = "image/jpeg"


@app.get(
    "/tiles/gibs/{z}/{x}/{y}.jpg",
    summary="Proxy a NASA GIBS Blue Marble tile",
    response_class=Response,
)
async def gibs_tile(z: int, x: int, y: int) -> Response:
    """
    Proxies a WMTS tile from NASA GIBS.

    GIBS uses the standard XYZ / GoogleMapsCompatible tile grid.
    Maximum native zoom for Blue Marble NextGeneration is z=8.
    """
    url = (
        f"{settings.gibs_base_url}/{GIBS_LAYER}/default/2004-08-01"
        f"/{GIBS_MATRIX_SET}/{z}/{y}/{x}.jpg"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        return Response(status_code=resp.status_code)
    return Response(content=resp.content, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Sentinel-2 composited overlay (high-zoom)
# ---------------------------------------------------------------------------

@app.get(
    "/tiles/sentinel/{z}/{x}/{y}",
    summary="Composited Sentinel-2 tile (cloud-free)",
    response_class=Response,
)
async def sentinel_tile(
    request: Request,
    z: int = Path(ge=0, le=20),
    x: int = Path(ge=0),
    y: int = Path(ge=0),
    passes: int = Query(default=8, ge=3, le=30),
) -> Response:
    """
    Returns a cloud-free Sentinel-2 tile produced by median compositing.
    Delegates to the compositing sub-app internally.
    Only meaningful at z ≥ 10; returns 404 for coarser zooms.
    """
    if z < 10:
        return Response(status_code=404, content="Sentinel tiles only available at z≥10")

    accept = request.headers.get("accept", "")
    # Re-use the compositing handler directly (avoids extra HTTP round-trip)
    return await get_composite_tile(z=z, x=x, y=y, passes=passes, accept=accept)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "tile-server"}
