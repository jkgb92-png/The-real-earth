"""
backend/tests/test_tile_server.py

Integration smoke-tests for the FastAPI tile server endpoints.

Run from repo root with:
    pytest backend/tests/
"""

import pytest
from fastapi.testclient import TestClient

from backend.tile_server import app


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Sentinel tile — returns 404 below z=10
# ---------------------------------------------------------------------------

def test_sentinel_tile_below_min_zoom():
    client = TestClient(app)
    response = client.get("/tiles/sentinel/8/120/80")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Composite tile — returns 404 when no tif files present
# ---------------------------------------------------------------------------

def test_composite_tile_missing():
    client = TestClient(app)
    response = client.get("/compositing/composite-tile/12/2050/1400.png")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# /api/terminator — structure and caching
# ---------------------------------------------------------------------------

def test_terminator_returns_geojson():
    client = TestClient(app)
    response = client.get("/api/terminator")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
    feature = data["features"][0]
    assert feature["geometry"]["type"] == "Polygon"
    props = feature["properties"]
    assert "declination_deg" in props
    assert "subsolar_lon" in props
    assert "computed_utc" in props


def test_terminator_polygon_is_closed():
    client = TestClient(app)
    response = client.get("/api/terminator")
    coords = response.json()["features"][0]["geometry"]["coordinates"][0]
    # GeoJSON polygon rings must start and end at the same point
    assert coords[0] == coords[-1]


def test_terminator_cache_returns_same_result():
    """Two back-to-back calls within the TTL should return identical data."""
    client = TestClient(app)
    r1 = client.get("/api/terminator")
    r2 = client.get("/api/terminator")
    assert r1.json() == r2.json()
