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


def test_sentinel_tile_year_param_below_min_zoom():
    """?year param should still 404 below z=10."""
    client = TestClient(app)
    response = client.get("/tiles/sentinel/9/200/100?year=2024")
    assert response.status_code == 404


def test_sentinel_tile_year_param_missing_data():
    """?year param with no matching tif files should return 404."""
    client = TestClient(app)
    # z=12 is above min-zoom but there are no tif files in the test store
    response = client.get("/tiles/sentinel/12/2050/1400?year=2024")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# NDVI tile endpoint
# ---------------------------------------------------------------------------

def test_ndvi_tile_below_min_zoom():
    """NDVI tiles are only available at z>=10."""
    client = TestClient(app)
    response = client.get("/tiles/ndvi/8/120/80")
    assert response.status_code == 404


def test_ndvi_tile_missing_data():
    """Returns 404 when no GeoTIFF passes exist for the requested tile."""
    client = TestClient(app)
    response = client.get("/tiles/ndvi/12/2050/1400")
    assert response.status_code == 404


def test_ndvi_tile_returns_png_with_data(monkeypatch, tmp_path):
    """With a synthetic 4-band GeoTIFF, the endpoint returns a valid PNG."""
    import io
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    # Build a minimal 4-band GeoTIFF (4×4 pixels) with NIR > Red
    tif_dir = tmp_path / "12" / "2048" / "1365"
    tif_dir.mkdir(parents=True)
    tif_path = tif_dir / "2024-01-01.tif"
    with rasterio.open(
        str(tif_path),
        "w",
        driver="GTiff",
        height=4,
        width=4,
        count=4,
        dtype=np.uint16,
        crs="EPSG:4326",
        transform=from_bounds(0, 0, 1, 1, 4, 4),
    ) as dst:
        # Red=100, NIR=800 → NDVI = (800-100)/(800+100) ≈ +0.78 (healthy veg)
        dst.write(np.full((4, 4), 100, dtype=np.uint16), 1)   # Red
        dst.write(np.full((4, 4), 150, dtype=np.uint16), 2)   # Green
        dst.write(np.full((4, 4), 120, dtype=np.uint16), 3)   # Blue
        dst.write(np.full((4, 4), 800, dtype=np.uint16), 4)   # NIR

    # Patch TILE_STORE to point at our tmp_path
    import backend.ndvi as ndvi_module
    monkeypatch.setattr(ndvi_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    response = client.get("/tiles/ndvi/12/2048/1365")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    # Verify the response is a valid PNG
    from PIL import Image
    img = Image.open(io.BytesIO(response.content))
    assert img.mode == "RGB"


def test_ndvi_tile_returns_webp_when_requested(monkeypatch, tmp_path):
    """Accept: image/webp triggers WebP response."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    tif_dir = tmp_path / "12" / "2048" / "1366"
    tif_dir.mkdir(parents=True)
    tif_path = tif_dir / "2024-06-15.tif"
    with rasterio.open(
        str(tif_path), "w", driver="GTiff", height=4, width=4,
        count=4, dtype=np.uint16, crs="EPSG:4326",
        transform=from_bounds(0, 0, 1, 1, 4, 4),
    ) as dst:
        dst.write(np.full((4, 4), 100, dtype=np.uint16), 1)   # Red
        dst.write(np.full((4, 4), 150, dtype=np.uint16), 2)   # Green
        dst.write(np.full((4, 4), 120, dtype=np.uint16), 3)   # Blue
        dst.write(np.full((4, 4), 900, dtype=np.uint16), 4)   # NIR

    import backend.ndvi as ndvi_module
    monkeypatch.setattr(ndvi_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    response = client.get(
        "/tiles/ndvi/12/2048/1366",
        headers={"Accept": "image/webp,image/png,*/*"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"


# ---------------------------------------------------------------------------
# SAR tile endpoint
# ---------------------------------------------------------------------------

def test_sar_tile_no_data_no_copernicus():
    """
    When SAR is disabled and no Copernicus client ID is configured,
    the endpoint returns 503.
    """
    client = TestClient(app)
    response = client.get("/tiles/sar/10/512/380")
    # Accept either 503 (no SAR enabled) or 404 (enabled but no data).
    assert response.status_code in (503, 404)


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
