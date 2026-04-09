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
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Real Earth — Globe</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/1.117/Build/Cesium/Widgets/widgets.css" rel="stylesheet" />
  <style>
    html, body, #cesiumContainer { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
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

    // Base layer: NASA GIBS Blue Marble via our tile server proxy
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: '${safeTileServer}/tiles/gibs/{z}/{x}/{reverseY}.jpg',
        maximumLevel: 8,
        credit: 'NASA GIBS',
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
    viewer.scene.skyAtmosphere.show = true;
    // Request higher-resolution tiles when zoomed in (default is 2)
    viewer.scene.globe.maximumScreenSpaceError = 1;
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
