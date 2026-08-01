/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@frank/pipeline-graph'],
};

export default nextConfig;
