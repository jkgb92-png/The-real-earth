import nianticData, { toFeatureCollection } from '../../agents/niantic';
import React from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const featureCollection = toFeatureCollection(nianticData as any);

export function NianticMapExample() {
  return (
    <MapContainer center={[37.775, -122.419]} zoom={14} style={{ height: 400, width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <GeoJSON data={featureCollection as any} />
    </MapContainer>
  );
}

export default NianticMapExample;
