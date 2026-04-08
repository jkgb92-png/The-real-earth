FROM node:20-alpine AS builder
WORKDIR /repo

# Copy root workspace manifests and lockfile
COPY package.json package-lock.json ./

# Copy workspace package.json files so npm can resolve the workspace graph
COPY apps/web/package.json apps/web/package.json
COPY packages/shaders/package.json packages/shaders/package.json
COPY packages/map-core/package.json packages/map-core/package.json
COPY packages/tile-cache/package.json packages/tile-cache/package.json

# Install all workspace dependencies from the repo root
RUN npm ci

# Copy the rest of the source tree
COPY . .

# Build only the web workspace (standalone output for Docker/Cloud Run)
ENV NEXT_OUTPUT_MODE=standalone
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./.next/static
COPY --from=builder /repo/apps/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
