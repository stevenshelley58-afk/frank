/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@frank/pipeline-graph', '@frank/memory'],
};

export default nextConfig;
