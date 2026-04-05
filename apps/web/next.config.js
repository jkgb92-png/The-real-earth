/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@the-real-earth/map-core',
    '@the-real-earth/tile-cache',
    '@the-real-earth/shaders',
  ],
};

module.exports = nextConfig;
