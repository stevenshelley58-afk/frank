/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@frank/pipeline-graph',
    '@frank/memory',
    '@frank/kernel',
    '@frank/contracts',
    '@frank/policy',
  ],
  webpack: (config) => {
    // Workspace packages use TypeScript source with `.js` import specifiers
    // (ESM convention). Teach webpack to resolve `./foo.js` → `./foo.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};

export default nextConfig;
