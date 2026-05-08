# Niantic Map Integration Example

This file shows a minimal React + Leaflet component that consumes the generated GeoJSON and renders it on a map.

Prereqs:
- react, react-dom
- react-leaflet and leaflet
- the project built so that `agents/niantic.ts` or `agents/niantic.json` is importable

Example component (TypeScript / React):

```tsx
import React from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
// If you export geojson using the CLI, import it like this:
// import nianticGeoJSON from '../../agents/niantic.geojson';
// Or convert the TypeScript data at runtime:
import nianticData, { toFeatureCollection } from '../../agents/niantic';

const featureCollection = toFeatureCollection(nianticData as any);

export default function NianticLayer() {
  return (
    <MapContainer center={[37.775, -122.419]} zoom={14} style={{ height: '100vh' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />

      <GeoJSON data={featureCollection as any} />
    </MapContainer>
  );
}
```

Notes
- If you prefer Mapbox GL or Deck.gl, convert the feature collection to the format those libraries expect.
- Use the provided CLI (scripts/export-geojson.ts) to create a static geojson file for static hosting or fast loading.
