/** @type {import('next').NextConfig} */

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
};

module.exports = nextConfig;
