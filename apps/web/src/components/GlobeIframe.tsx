'use client';

/**
 * apps/web/src/components/GlobeIframe.tsx
 *
 * Embeds the CesiumJS globe as a full-screen iframe pointing at the
 * /globe route (which is a standalone HTML page served by Next.js).
 *
 * This keeps the heavy CesiumJS bundle out of the main app bundle.
 *
 * Spec-Ops additions
 * ──────────────────
 * The component now holds a ref to the <iframe> element and renders the
 * SpecOpsToolbar as a React overlay on top of the iframe.  The toolbar
 * communicates with globe.html (and ultimately spec-ops-worker.js) via
 * iframe.contentWindow.postMessage().  Outbound events (feature toggles)
 * are surfaced to parent components through the optional `onSpecOpsChange`
 * callback.
 */

import React, { useEffect, useRef } from 'react';
import { SpecOpsFeature, SpecOpsToolbar } from './SpecOpsToolbar';

interface Props {
  tileServerUrl: string;
  /** Called whenever a Spec-Ops feature is toggled on or off. */
  onSpecOpsChange?: (feature: SpecOpsFeature, enabled: boolean) => void;
  /** Whether the IR (MODIS Land Surface Temperature) overlay is active. */
  irEnabled?: boolean;
  /** IR overlay intensity in [0, 1]. */
  irIntensity?: number;
}

export function GlobeIframe({ tileServerUrl, onSpecOpsChange, irEnabled, irIntensity }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Use an explicit relative path (./globe.html) so it resolves correctly
  // on GitHub Pages (basePath=/The-real-earth) and in local dev / standalone
  // deployments without needing a route handler.
  const src = `./globe.html?tileServer=${encodeURIComponent(tileServerUrl)}`;

  // Forward IR layer changes into the Cesium globe via postMessage.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Use the same-origin as the parent; globe.html is always served from the
    // same host so this is safe and avoids the '*' wildcard security risk.
    const targetOrigin = window.location.origin;
    win.postMessage(
      { type: 'irLayer', enabled: !!irEnabled, intensity: irIntensity ?? 0.6 },
      targetOrigin,
    );
  }, [irEnabled, irIntensity]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <iframe
        ref={iframeRef}
        src={src}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="3D Globe"
        allow="accelerometer; camera; gyroscope"
      />

      {/* Spec-Ops HUD — floats above the iframe, pointer-events handled internally */}
      <SpecOpsToolbar iframeRef={iframeRef} onToggle={onSpecOpsChange} />
    </div>
  );
}

