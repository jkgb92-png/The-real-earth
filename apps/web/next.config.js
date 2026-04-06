/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: '/The-real-earth',
  assetPrefix: '/The-real-earth/',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    '@the-real-earth/map-core',
    '@the-real-earth/tile-cache',
    '@the-real-earth/shaders',
  ],
};

module.exports = nextConfig;
