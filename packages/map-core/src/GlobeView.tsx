/**
 * packages/map-core/src/GlobeView.tsx
 *
 * CesiumJS 3D Globe mode — rendered inside a WebView for both mobile and web.
 *
 * The globe view is toggled by the user via a button in the main UI.
 * It loads a self-contained HTML page that:
 *  1. Initialises a CesiumJS Viewer.
 *  2. Adds the NASA GIBS raster layer.
 *  3. Applies the Rayleigh scattering PostProcessStage.
 *
 * Communication between React Native and the WebView is done via
 * postMessage / onMessage.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { rayleighShader } from '@the-real-earth/shaders';

// react-native-webview is a peer dependency
let WebView: React.ComponentType<{ source: { html: string }; style?: object }> | null = null;
try {
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

export interface GlobeViewProps {
  tileServerUrl: string;
  cesiumIonToken?: string;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function buildGlobeHtml(tileServerUrl: string, cesiumIonToken: string, shader: string): string {
  const safeTileServer = escapeHtmlAttr(tileServerUrl);
  const safeToken = escapeHtmlAttr(cesiumIonToken);
  // The shader is a compile-time constant; escape backticks/$ for template literal safety
  const safeShader = shader.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  // BlueMarble_NextGeneration is only available via GIBS EPSG:4326 — the
  // epsg3857 endpoint returns 400 for this layer.  Both the proxy path and the
  // direct fallback therefore use EPSG:4326 coordinates via Cesium's
  // GeographicTilingScheme.  WMTS TileRow 0 is the northernmost row, which
  // matches Cesium's {y} template variable (y=0 at top); {reverseY} would flip
  // tiles north/south.
  const GIBS_EPSG4326_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
  const TILE_SERVER_DEFAULT = 'http://localhost:8000';
  const useProxy = tileServerUrl !== '' && tileServerUrl !== TILE_SERVER_DEFAULT;
  const gibsUrl = useProxy
    ? `${safeTileServer}/tiles/gibs/{z}/{x}/{y}.jpg`
    : `${GIBS_EPSG4326_BASE}/BlueMarble_NextGeneration/default/2004-08-01/250m/{z}/{y}/{x}.jpg`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Real Earth — Globe</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Widgets/widgets.css" rel="stylesheet" />
  <style>
    html, body, #cesiumContainer { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #0a0a1a; }
  </style>
</head>
<body>
  <div id="cesiumContainer"></div>
  <script>
    Cesium.Ion.defaultAccessToken = '${safeToken}';

    const viewer = new Cesium.Viewer('cesiumContainer', {
      imageryProvider: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      creditContainer: document.createElement('div'), // hide credit overlay
    });

    // Base layer: NASA GIBS Blue Marble (EPSG:4326 / GeographicTilingScheme).
    // Tile size is 512×512 px; maximumLevel 8 matches GIBS 250 m resolution.
    // Uses {y} (WMTS row 0 = north), not {reverseY} (TMS row 0 = south).
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: '${gibsUrl}',
        tilingScheme: new Cesium.GeographicTilingScheme(),
        tileWidth: 512,
        tileHeight: 512,
        maximumLevel: 8,
        credit: 'NASA GIBS / Blue Marble',
      })
    );

    // ESRI World Imagery — high-resolution gap-fill at all zoom levels.
    // No minimumLevel: ESRI has global coverage from z=0, so it renders on top
    // of GIBS at all zooms and provides full detail above z=8 where GIBS stops.
    // maximumLevel capped at 17: above this ESRI 404s in sparse areas; Cesium
    // will overzoom the z=17 tile instead of showing a missing-tile placeholder.
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 17,
        credit: 'Esri World Imagery',
      })
    );

    // Atmospheric Rayleigh scattering post-process stage
    const rayleighShader = \`${safeShader}\`;
    viewer.scene.postProcessStages.add(
      new Cesium.PostProcessStage({
        fragmentShader: rayleighShader,
        uniforms: {
          altitude: function() {
            return viewer.camera.positionCartographic.height;
          },
        },
      })
    );

    // Enable atmosphere and lighting
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050814');
    viewer.scene.skyAtmosphere.show = true;
    // Request tiles at 1:1 screen pixels — eliminates blurry upscaling.
    viewer.scene.globe.maximumScreenSpaceError = 1;
    // Render at native device pixel ratio for crisp imagery on Retina/HiDPI
    // screens.  Cap at 2× to avoid excessive GPU overhead on very high-DPI devices.
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

    // ── Ground-level POV: collision detection + minimum zoom ─────────────────
    // Prevent the camera from clipping through the terrain mesh so the user
    // can navigate at street level without going underground.
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    // Allow the camera to get within 2 m of the surface for ground-level POV.
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 2.0;

    // ── Adaptive LOD: sharpen terrain mesh at very close range ───────────────
    // Below 100 m (street level), use SSE=0.1 for maximum polygon detail.
    viewer.scene.preRender.addEventListener(function () {
      const altKm = viewer.camera.positionCartographic.height / 1000;
      let sse;
      if (altKm > 200) {
        sse = 2;
      } else if (altKm < 0.1) {
        sse = 0.1;
      } else if (altKm < 5) {
        sse = 0.5;
      } else {
        sse = 2 - (1.5 * (200 - altKm) / 195);
      }
      viewer.scene.globe.maximumScreenSpaceError = Math.max(0.1, sse);
    });
  </script>
</body>
</html>`;
}

export function GlobeView({ tileServerUrl, cesiumIonToken = '' }: GlobeViewProps): React.ReactElement {
  const html = buildGlobeHtml(tileServerUrl, cesiumIonToken, rayleighShader);

  if (!WebView) {
    return <View style={styles.placeholder} />;
  }

  return (
    <WebView
      source={{ html }}
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1 },
  placeholder: { flex: 1, backgroundColor: '#0a0a1a' },
});
