"""
backend/config.py

Centralised settings loaded from environment variables / .env file.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Tile storage
    tile_store_path: str = "tiles"

    # NASA GIBS
    gibs_base_url: str = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"

    # SAR model
    sar_model_path: str = "sar_reconstruct/model.pt"
    sar_feature_enabled: bool = False

    # Copernicus / ESA
    copernicus_client_id: str = ""
    copernicus_client_secret: str = ""

    # CORS — comma-separated list of allowed origins.
    # Set CORS_ORIGINS to your Vercel frontend URL in production, e.g.:
    #   CORS_ORIGINS=https://the-real-earth.vercel.app
    # Defaults to "*" (open) for local development.
    cors_origins: str = "*"
