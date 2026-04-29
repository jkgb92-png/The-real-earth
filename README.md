# The Real Earth 🌍

A cross-platform Earth observation app (Web, iOS, Android) featuring seamless,
high-resolution satellite imagery with zero cloud artifacts.

## Architecture

```
The-real-earth/
├── apps/
│   ├── mobile/          # Expo React Native (iOS + Android)
│   └── web/             # Next.js + React Native Web
├── backend/
│   ├── compositing.py   # Median-pixel compositing (cloud removal)
│   ├── tile_server.py   # WMTS/TMS tile delivery (FastAPI)
│   └── sar_reconstruct/ # SAR-to-optical model serving
├── packages/
│   ├── map-core/        # Shared Mapbox/Cesium abstraction layer
│   ├── tile-cache/      # MBTiles SQLite cache logic
│   └── shaders/         # GLSL atmospheric shaders
└── infra/
    ├── docker-compose.yml
    └── terraform/       # Cloud tile CDN (GCS + Cloud Run)
```

## Cloud Build (Google Cloud)

To build and deploy the web app using a Google Cloud Build **Dockerfile** trigger,
configure the trigger with:

| Field | Value |
|-------|-------|
| **Dockerfile directory** | `apps/web` |
| **Dockerfile name** | `Dockerfile` |

Cloud Build will use `apps/web` as the Docker build context.  The `apps/web`
directory is self-contained: it has its own `package.json` / `package-lock.json`
and the Dockerfile sets `NEXT_OUTPUT_MODE=standalone` so the resulting image
starts with `node server.js` on port 3000.

## Quick Start

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn tile_server:app --reload
```

### Mobile
```bash
cd apps/mobile
npm install
npx expo start
```

### Web
```bash
cd apps/web
npm install
npm run dev
```

### All services (Docker)
```bash
docker compose -f infra/docker-compose.yml up
```

## Key Features

- **Cloud-free imagery** via temporal median compositing of multi-pass Sentinel-2 tiles
- **SAR fallback** — Sentinel-1 radar data reconstructed to optical via pix2pix when clouds persist
- **60 FPS mobile rendering** — native Mapbox SDK (`@rnmapbox/maps`) on iOS/Android
- **3D Globe mode** — CesiumJS in a WebView with Rayleigh scattering atmosphere shader
- **Offline caching** — MBTiles SQLite store with LRU eviction and stale-while-revalidate
- **Dynamic resolution scaling** — memory-safe tile loading adapts to device RAM

## Data Sources

| Source | Resolution | Cloud-Free | Notes |
|--------|-----------|-----------|-------|
| NASA GIBS WMTS | 500 m | ✅ | Base layer (Blue Marble) |
| Sentinel-2 (ESA) | 10 m | ❌ | High-zoom optical overlay |
| Sentinel-1 SAR | 10 m | ✅ | Cloud-penetrating radar |
| MODIS Terra/Aqua | 250 m | Partial | Daily global coverage |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAPBOX_ACCESS_TOKEN` | Mapbox public token (mobile + web) |
| `COPERNICUS_CLIENT_ID` | ESA Copernicus Hub credentials |
| `COPERNICUS_CLIENT_SECRET` | ESA Copernicus Hub credentials |
| `GIBS_BASE_URL` | NASA GIBS WMTS endpoint (default provided) |
| `SAR_MODEL_PATH` | Path to TorchScript SAR-to-optical model |
| `TILE_STORE_PATH` | Local directory for raw GeoTIFF tile archives |
| `A1111_ENABLED` | Set `true` to enable AI tile enhancement via AUTOMATIC1111 |
| `A1111_URL` | AUTOMATIC1111 server URL (default: `http://localhost:7860`) |
