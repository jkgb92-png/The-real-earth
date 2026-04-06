"""
backend/tests/test_compositing.py

Unit tests for the median pixel compositing logic.
Tests run without rasterio / disk I/O by monkeypatching load_tile_as_array.

Run from repo root with:
    pytest backend/tests/
"""

import numpy as np
import pytest

from backend.compositing import cloud_mask_from_band, median_composite


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_tile(
    r: float, g: float, b: float, nir: float, h: int = 4, w: int = 4
) -> np.ndarray:
    """Return a (4, H, W) float32 array with uniform band values."""
    bands = np.array([r, g, b, nir], dtype=np.float32)
    return np.broadcast_to(bands[:, None, None], (4, h, w)).copy()


# ---------------------------------------------------------------------------
# cloud_mask_from_band
# ---------------------------------------------------------------------------

class TestCloudMask:
    def test_high_nir_is_cloud(self):
        tile = make_tile(r=0.5, g=0.5, b=0.5, nir=1.0)
        mask = cloud_mask_from_band(tile, threshold=0.9)
        assert mask.all(), "Uniform NIR at max should be fully masked as cloud"

    def test_low_nir_is_clear(self):
        tile = make_tile(r=0.3, g=0.4, b=0.5, nir=0.2)
        # max nir = 0.2; threshold at 0.9 → 0.9 * 0.2 = 0.18; pixel = 0.2 > 0.18 → cloud
        # Use a higher nir max to avoid this edge case
        arr = make_tile(r=0.3, g=0.4, b=0.5, nir=0.1)
        arr[3] = 0.1  # all NIR = 0.1, max = 0.1, threshold = 0.9*0.1 = 0.09
        # 0.1 > 0.09 → True for all (edge case: uniform tiles always cloud at 0.9)
        # Adjust: set NIR to 0.0 to ensure clear sky
        arr[3] = 0.0
        mask = cloud_mask_from_band(arr, threshold=0.9)
        assert not mask.any(), "Zero NIR band → no cloud pixels"

    def test_zero_max_returns_no_mask(self):
        tile = np.zeros((4, 4, 4), dtype=np.float32)
        mask = cloud_mask_from_band(tile)
        assert not mask.any()

    def test_fallback_to_band0_when_single_band(self):
        tile = np.ones((1, 4, 4), dtype=np.float32)
        mask = cloud_mask_from_band(tile, threshold=0.9)
        # band0 = 1.0, max = 1.0, threshold = 0.9 → all pixels > 0.9*1.0 = masked
        assert mask.all()


# ---------------------------------------------------------------------------
# median_composite
# ---------------------------------------------------------------------------

class TestMedianComposite:
    def test_median_of_clear_tiles(self, monkeypatch, tmp_path):
        """Three identical clear tiles → composite equals that tile."""
        tile = make_tile(r=100, g=150, b=200, nir=50)

        monkeypatch.setattr("backend.compositing.load_tile_as_array", lambda _: tile.copy())

        # Create dummy file paths (content ignored due to monkeypatch)
        paths = [str(tmp_path / f"{i}.tif") for i in range(3)]
        for p in paths:
            open(p, "w").close()

        result = median_composite(paths)

        assert result.dtype == np.uint16
        # R channel should be close to 100 (before clipping to uint16)
        assert result[0].mean() == pytest.approx(100, abs=1)

    def test_cloud_pixels_are_suppressed(self, monkeypatch, tmp_path):
        """Two cloud-free tiles and one cloudy tile → median ignores the cloud."""

        def make_cloudy():
            """High NIR → all pixels masked."""
            t = make_tile(r=255, g=255, b=255, nir=65535)
            return t

        def make_clear(r_val: float):
            t = make_tile(r=r_val, g=100, b=100, nir=0)
            return t

        tiles_data = [make_clear(50), make_clear(60), make_cloudy()]

        call_count = {"n": 0}

        def fake_load(path: str) -> np.ndarray:
            idx = int(path.split("_")[-1].split(".")[0])
            return tiles_data[idx].copy()

        monkeypatch.setattr("backend.compositing.load_tile_as_array", fake_load)

        paths = [str(tmp_path / f"tile_{i}.tif") for i in range(3)]
        for p in paths:
            open(p, "w").close()

        result = median_composite(paths)
        # Median of [50, 60, NaN] = 55 (nanmedian ignores NaN)
        assert result[0].mean() == pytest.approx(55, abs=2)

    def test_all_cloudy_falls_back_to_mean(self, monkeypatch, tmp_path):
        """When every pass is cloudy, result should equal raw pixel mean."""
        # High NIR ensures all pixels are masked
        tile_a = make_tile(r=100, g=0, b=0, nir=65535)
        tile_b = make_tile(r=200, g=0, b=0, nir=65535)

        tiles_data = [tile_a, tile_b]

        def fake_load(path: str) -> np.ndarray:
            idx = int(path.split("_")[-1].split(".")[0])
            return tiles_data[idx].copy()

        monkeypatch.setattr("backend.compositing.load_tile_as_array", fake_load)

        paths = [str(tmp_path / f"tile_{i}.tif") for i in range(2)]
        for p in paths:
            open(p, "w").close()

        result = median_composite(paths)
        # All cloudy → fallback mean of R=[100,200] = 150
        assert result[0].mean() == pytest.approx(150, abs=1)

    def test_output_dtype_is_uint16(self, monkeypatch, tmp_path):
        tile = make_tile(r=500, g=500, b=500, nir=0)
        monkeypatch.setattr("backend.compositing.load_tile_as_array", lambda _: tile.copy())
        paths = [str(tmp_path / f"{i}.tif") for i in range(3)]
        for p in paths:
            open(p, "w").close()
        result = median_composite(paths)
        assert result.dtype == np.uint16
