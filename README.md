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

## Deploy

> Config files (`render.yaml`, `vercel.json`, `.github/workflows/ci.yml`) are already included in this repo.

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → import this repository.
2. Vercel reads `vercel.json` automatically — it sets the root directory to `apps/web`, the install command to `npm ci` (run from the repo root so npm workspaces resolve), and the build command to `npm run build --workspace=apps/web`.
3. Add the following **Environment Variables** in the Vercel dashboard:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_TILE_SERVER_URL` | Your Render backend URL (e.g. `https://the-real-earth-backend.onrender.com`) |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | Your Mapbox public token |
   | `NEXT_PUBLIC_CESIUM_ION_TOKEN` | *(optional)* Your Cesium Ion token |

4. Click **Deploy**. Subsequent pushes to `main` auto-deploy.

### Backend → Render

1. Go to [render.com](https://render.com) → **New** → **Blueprint** → connect this repository.
   Render reads `render.yaml` and creates the `the-real-earth-backend` Web Service automatically using `backend/Dockerfile`.
2. Add the following **Secret** environment variables in the Render dashboard (never commit real values):

   | Variable | Description |
   |---|---|
   | `COPERNICUS_CLIENT_ID` | ESA Copernicus Hub client ID |
   | `COPERNICUS_CLIENT_SECRET` | ESA Copernicus Hub client secret |
   | `CORS_ORIGINS` | Your Vercel frontend URL (e.g. `https://the-real-earth.vercel.app`) |

3. Click **Apply**. Render builds the Docker image and starts the service. The `/health` endpoint is used as the health check.

### CI (GitHub Actions)

Every push / PR to `main` runs `.github/workflows/ci.yml`:
- **frontend** job: `npm ci` → typecheck → lint → build for `apps/web`
- **backend** job: `pip install` → `pytest backend/tests/`

No secrets are needed for CI to run.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAPBOX_ACCESS_TOKEN` | Mapbox public token (mobile + web) |
| `COPERNICUS_CLIENT_ID` | ESA Copernicus Hub credentials |
| `COPERNICUS_CLIENT_SECRET` | ESA Copernicus Hub credentials |
| `GIBS_BASE_URL` | NASA GIBS WMTS endpoint (default provided) |
| `SAR_MODEL_PATH` | Path to TorchScript SAR-to-optical model |
| `TILE_STORE_PATH` | Local directory for raw GeoTIFF tile archives |
