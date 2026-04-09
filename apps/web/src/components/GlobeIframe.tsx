'use client';

/**
 * apps/web/src/components/GlobeIframe.tsx
 *
 * Embeds the CesiumJS globe as a full-screen iframe pointing at the
 * /globe route (which is a standalone HTML page served by Next.js).
 *
 * This keeps the heavy CesiumJS bundle out of the main app bundle.
 */

import React from 'react';

interface Props {
  tileServerUrl: string;
}

export function GlobeIframe({ tileServerUrl }: Props) {
  // Use a relative URL so it works both on GitHub Pages (basePath=/The-real-earth)
  // and in local dev / standalone deployments without needing a route handler.
  const src = `globe.html?tileServer=${encodeURIComponent(tileServerUrl)}`;
  return (
    <iframe
      src={src}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="3D Globe"
      allow="accelerometer; camera; gyroscope"
    />
  );
}
