/** @type {import('next').NextConfig} */
const path = require('path');

// When NEXT_OUTPUT_MODE=standalone the app is built for Docker/Cloud Run
// (no basePath, standalone server). The default is 'export' for GitHub Pages.
const isStandalone = process.env.NEXT_OUTPUT_MODE === 'standalone';

const nextConfig = {
  output: isStandalone ? 'standalone' : 'export',
  ...(isStandalone
    ? {}
    : {
        trailingSlash: true,
        basePath: '/The-real-earth',
        assetPrefix: '/The-real-earth/',
      }),
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  webpack(config) {
    // expo-sqlite and expo-file-system are React Native / Expo packages that
    // contain JSX and RN-specific syntax.  They are pulled in transitively by
    // packages/tile-cache (TileCache.ts), but TileCache is never used on web –
    // only WorkerTileCache is.  Alias them to empty stubs so the Next.js build
    // does not try to parse React Native source.
    config.resolve.alias = {
      ...config.resolve.alias,
      'expo-sqlite': path.resolve(__dirname, 'src/stubs/expo-stub.js'),
      'expo-file-system': path.resolve(__dirname, 'src/stubs/expo-stub.js'),
      'react-native': path.resolve(__dirname, 'src/stubs/react-native-stub.js'),
    };
    return config;
  },
};

module.exports = nextConfig;
