FROM python:3.12-slim

WORKDIR /app

# System dependencies for rasterio / GDAL
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements from backend/ subdir (build context is repo root)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

EXPOSE 8000

# Use shell form so ${PORT:-8000} is evaluated at container start-time.
# Render sets $PORT automatically; local runs fall back to 8000.
CMD uvicorn backend.tile_server:app --host 0.0.0.0 --port ${PORT:-8000}
