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
