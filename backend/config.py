"""
backend/config.py

Centralised settings loaded from environment variables / .env file.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # CORS — comma-separated list of allowed origins; "*" allows all (dev default)
    cors_origins: str = "*"

    # Tile storage
    tile_store_path: str = "tiles"

    # NASA GIBS
    # BlueMarble_NextGeneration is only available in EPSG:4326 (the epsg3857
    # endpoint returns 400 for this layer).  The correct TileMatrixSet for
    # this layer is "500m" (500 m/pixel native resolution, max level 8).
    gibs_base_url: str = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"

    # SAR model
    sar_model_path: str = "sar_reconstruct/model.pt"
    sar_feature_enabled: bool = False

    # Copernicus / ESA
    copernicus_client_id: str = ""
    copernicus_client_secret: str = ""
