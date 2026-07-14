/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // 复利工程：开启 typedRoutes
  experimental: {
    typedRoutes: true,
  },
};

module.exports = nextConfig;
