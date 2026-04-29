"""
backend/tests/test_tile_server.py

Integration smoke-tests for the FastAPI tile server endpoints.

Run from repo root with:
    pytest backend/tests/
"""

import pytest
from fastapi.testclient import TestClient

import backend.tile_server
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
# Overzoom synthesis — sentinel tiles synthesized from a parent zoom level
# ---------------------------------------------------------------------------

def _write_sentinel_tif(tif_path, r=1000, g=1200, b=900, nir=200):
    """Write a minimal 4-band GeoTIFF (4×4 px) to *tif_path*."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    tif_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        str(tif_path), "w", driver="GTiff", height=4, width=4,
        count=4, dtype=np.uint16, crs="EPSG:4326",
        transform=from_bounds(0, 0, 1, 1, 4, 4),
    ) as dst:
        dst.write(np.full((4, 4), r,   dtype=np.uint16), 1)
        dst.write(np.full((4, 4), g,   dtype=np.uint16), 2)
        dst.write(np.full((4, 4), b,   dtype=np.uint16), 3)
        dst.write(np.full((4, 4), nir, dtype=np.uint16), 4)


def test_sentinel_overzoom_returns_png(monkeypatch, tmp_path):
    """
    When the tile store has data at z=18 but not z=20, a request for z=20
    should synthesize a tile from the z=18 ancestor and return HTTP 200 PNG.

    x=20, y=20 at z=20 → parent at z=18 is x=20>>2=5, y=20>>2=5.
    """
    parent_z, parent_x, parent_y = 18, 5, 5
    tif_dir = tmp_path / str(parent_z) / str(parent_x) / str(parent_y)
    for fname in ("2024-01-01.tif", "2024-02-01.tif"):
        _write_sentinel_tif(tif_dir / fname)

    import backend.compositing as comp_module
    monkeypatch.setattr(comp_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    response = client.get("/tiles/sentinel/20/20/20")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"

    from PIL import Image
    import io as _io
    img = Image.open(_io.BytesIO(response.content))
    assert img.size == (256, 256)


def test_sentinel_overzoom_returns_webp(monkeypatch, tmp_path):
    """
    Same overzoom scenario but with Accept: image/webp — should return WebP.
    """
    parent_z, parent_x, parent_y = 18, 5, 5
    tif_dir = tmp_path / str(parent_z) / str(parent_x) / str(parent_y)
    for fname in ("2024-01-01.tif", "2024-02-01.tif"):
        _write_sentinel_tif(tif_dir / fname)

    import backend.compositing as comp_module
    monkeypatch.setattr(comp_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    response = client.get(
        "/tiles/sentinel/20/20/20",
        headers={"Accept": "image/webp,image/png,*/*"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"


def test_sentinel_overzoom_returns_404_when_no_ancestor(monkeypatch, tmp_path):
    """
    When no ancestor tile exists within _MAX_OVERZOOM_STEPS, the endpoint
    should still return 404 rather than a synthesized tile.
    """
    import backend.compositing as comp_module
    monkeypatch.setattr(comp_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    # tmp_path is empty → no tile data at any zoom level
    response = client.get("/tiles/sentinel/20/20/20")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Overzoom synthesis — NDVI tiles synthesized from a parent zoom level
# ---------------------------------------------------------------------------

def test_ndvi_overzoom_returns_png(monkeypatch, tmp_path):
    """
    When NDVI tile store has data at z=18 but not z=20, requesting z=20
    should synthesize a colourised NDVI tile and return HTTP 200 PNG.
    """
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    parent_z, parent_x, parent_y = 18, 5, 5
    tif_dir = tmp_path / str(parent_z) / str(parent_x) / str(parent_y)
    tif_dir.mkdir(parents=True)

    tif_path = tif_dir / "2024-01-01.tif"
    with rasterio.open(
        str(tif_path), "w", driver="GTiff", height=4, width=4,
        count=4, dtype=np.uint16, crs="EPSG:4326",
        transform=from_bounds(0, 0, 1, 1, 4, 4),
    ) as dst:
        # NIR > Red → positive NDVI (healthy vegetation)
        dst.write(np.full((4, 4), 100, dtype=np.uint16), 1)  # Red
        dst.write(np.full((4, 4), 150, dtype=np.uint16), 2)  # Green
        dst.write(np.full((4, 4), 120, dtype=np.uint16), 3)  # Blue
        dst.write(np.full((4, 4), 800, dtype=np.uint16), 4)  # NIR

    import backend.ndvi as ndvi_module
    monkeypatch.setattr(ndvi_module, "TILE_STORE", tmp_path)

    client = TestClient(app)
    response = client.get("/tiles/ndvi/20/20/20")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"

    from PIL import Image
    import io as _io
    img = Image.open(_io.BytesIO(response.content))
    assert img.size == (256, 256)


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


# ---------------------------------------------------------------------------
# /api/ai-enhance — AUTOMATIC1111 integration
# ---------------------------------------------------------------------------

def _make_png(color: tuple = (100, 150, 100), size: tuple = (4, 4)) -> bytes:
    """Return a minimal in-memory PNG with the given solid colour."""
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="PNG")
    return buf.getvalue()


def test_ai_enhance_feature_disabled():
    """Returns 503 when A1111_ENABLED is false (the default)."""
    client = TestClient(app)
    response = client.post(
        "/api/ai-enhance",
        files={"file": ("tile.png", _make_png(), "image/png")},
    )
    assert response.status_code == 503


def test_ai_enhance_empty_file(monkeypatch):
    """Returns 400 when an empty file is uploaded."""
    monkeypatch.setattr(backend.tile_server.settings, "a1111_enabled", True)
    client = TestClient(app)
    response = client.post(
        "/api/ai-enhance",
        files={"file": ("tile.png", b"", "image/png")},
    )
    assert response.status_code == 400


def test_ai_enhance_success(monkeypatch):
    """Returns enhanced PNG when A1111 responds successfully."""
    import base64
    from unittest.mock import AsyncMock, MagicMock, patch

    tile_bytes = _make_png(color=(100, 150, 100))
    out_b64 = base64.b64encode(_make_png(color=(120, 160, 120))).decode()

    monkeypatch.setattr(backend.tile_server.settings, "a1111_enabled", True)
    monkeypatch.setattr(backend.tile_server.settings, "a1111_url", "http://fakeserver")

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"images": [out_b64]}

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_resp)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.a1111.httpx.AsyncClient", return_value=mock_client_instance):
        client = TestClient(app)
        response = client.post(
            "/api/ai-enhance",
            files={"file": ("tile.png", tile_bytes, "image/png")},
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_ai_enhance_a1111_error(monkeypatch):
    """Returns 502 when the A1111 server raises an error."""
    from unittest.mock import AsyncMock, patch

    tile_bytes = _make_png()

    monkeypatch.setattr(backend.tile_server.settings, "a1111_enabled", True)
    monkeypatch.setattr(backend.tile_server.settings, "a1111_url", "http://fakeserver")

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(side_effect=Exception("Connection refused"))
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.a1111.httpx.AsyncClient", return_value=mock_client_instance):
        client = TestClient(app)
        response = client.post(
            "/api/ai-enhance",
            files={"file": ("tile.png", tile_bytes, "image/png")},
        )

    assert response.status_code == 502
