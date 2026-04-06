"""
backend/tile_server.py

WMTS/TMS tile delivery gateway (FastAPI).

Responsibilities
----------------
- Proxy NASA GIBS WMTS as the base Blue-Marble layer.
- Serve locally composited Sentinel-2 tiles for high-zoom requests (z ≥ 10).
- Accept ``Accept: image/webp`` for compressed delivery.
- Mount the compositing router so both services share one process.
- Provide /api/terminator — real-time day/night terminator GeoJSON (cached 60 s).
- Provide /api/iss — proxied ISS position from wheretheiss.at (cached 5 s).

Run with:
    uvicorn backend.tile_server:app --reload --port 8000
"""

from __future__ import annotations

import math
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .compositing import app as compositing_app, get_composite_tile
from .config import Settings

settings = Settings()

app = FastAPI(title="The Real Earth — Tile Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
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


# ---------------------------------------------------------------------------
# /api/terminator — real-time day/night terminator GeoJSON
# ---------------------------------------------------------------------------

# Simple 60-second cache (timestamp + cached payload)
_terminator_cache: Dict[str, Any] = {"ts": 0.0, "data": None}
_TERMINATOR_TTL = 60.0  # seconds
_TERMINATOR_STEPS = 361


def _compute_terminator_geojson() -> dict:
    """
    Compute the current day/night boundary as a GeoJSON FeatureCollection.

    The terminator polygon covers the night hemisphere.  The algorithm:
      1. Compute solar declination from the day-of-year.
      2. Compute the sub-solar longitude from UTC hours.
      3. For each longitude step find the latitude at which solar zenith = 90°.
      4. Close the polygon over the appropriate pole.
    """
    now = time.gmtime()
    day_of_year = now.tm_yday
    utc_hours = now.tm_hour + now.tm_min / 60.0 + now.tm_sec / 3600.0

    # Solar declination (degrees), accurate to ~0.5°
    declination = -23.45 * math.cos(
        math.radians((360.0 / 365.25) * (day_of_year + 10))
    )
    decl_rad = math.radians(declination)

    # Sub-solar longitude: at 00:00 UTC the sub-solar point is at 180°,
    # advancing westward (−) 15°/hr.
    subsolar_lon = (utc_hours / 24.0) * -360.0 + 180.0

    coords = []
    for i in range(_TERMINATOR_STEPS):
        lon = -180.0 + (360.0 * i) / (_TERMINATOR_STEPS - 1)
        hour_angle_rad = math.radians(lon - subsolar_lon)
        if abs(decl_rad) < 1e-9:
            # Equinox: terminator is a meridian; north/south depends on HA
            lat = 90.0 if math.cos(hour_angle_rad) < 0 else -90.0
        else:
            # Derived from solar zenith = 90°:
            # cos(zenith) = sin(lat)*sin(decl) + cos(lat)*cos(decl)*cos(HA) = 0
            # → tan(lat) = -cos(HA) / tan(decl)
            lat = math.degrees(
                math.atan(-math.cos(hour_angle_rad) / math.tan(decl_rad))
            )
        coords.append([lon, lat])

    # Determine which pole is in night
    north_in_night = declination < 0
    pole_lat = -90.0 if north_in_night else 90.0

    polygon = coords + [[180.0, pole_lat], [-180.0, pole_lat], coords[0]]

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [polygon]},
                "properties": {
                    "declination_deg": round(declination, 4),
                    "subsolar_lon": round((subsolar_lon % 360 + 360) % 360 - 180, 4),
                    "computed_utc": time.strftime("%H:%M:%S", now),
                },
            }
        ],
    }


@app.get(
    "/api/terminator",
    summary="Real-time day/night terminator as GeoJSON (cached 60 s)",
)
async def terminator() -> dict:
    """
    Returns the current day/night terminator boundary as a GeoJSON
    FeatureCollection with a single Polygon feature covering the night side.

    Result is cached for 60 seconds to avoid recomputing on every tile request.
    """
    now = time.monotonic()
    if now - _terminator_cache["ts"] > _TERMINATOR_TTL or _terminator_cache["data"] is None:
        _terminator_cache["data"] = _compute_terminator_geojson()
        _terminator_cache["ts"] = now
    return _terminator_cache["data"]


# ---------------------------------------------------------------------------
# /api/iss — proxied ISS position (cached 5 s)
# ---------------------------------------------------------------------------

_iss_cache: Dict[str, Any] = {"ts": 0.0, "data": None}
_ISS_TTL = 5.0  # seconds
_ISS_API = "https://api.wheretheiss.at/v1/satellites/25544"


@app.get(
    "/api/iss",
    summary="Live ISS position proxied from wheretheiss.at (cached 5 s)",
)
async def iss_position() -> Response:
    """
    Proxies the ISS position from wheretheiss.at and caches it for 5 seconds.

    Returns JSON with: latitude, longitude, altitude (km), velocity (km/h),
    timestamp (Unix seconds).

    Using a server-side proxy avoids CORS preflight requests from the browser
    and ensures a single outbound connection regardless of active clients.
    """
    now = time.monotonic()
    if now - _iss_cache["ts"] > _ISS_TTL or _iss_cache["data"] is None:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(_ISS_API)
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="ISS API unavailable")
        _iss_cache["data"] = resp.content
        _iss_cache["ts"] = now

    return Response(
        content=_iss_cache["data"],
        media_type="application/json",
        headers={"Cache-Control": f"public, max-age={int(_ISS_TTL)}"},
    )
