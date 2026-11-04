/** @type {import('next').NextConfig} */
const nextConfig = {
  // CI also builds this app with webpack into .next-webpack (see package.json).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // usertax attributes bytes to modules and packages through source maps.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
