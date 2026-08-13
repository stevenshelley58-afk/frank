/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone packaging needs symlink permission — unavailable on stock
  // Windows shells. Local verification builds opt out via NEXT_SKIP_STANDALONE=1;
  // VPS/Docker builds keep the default standalone output.
  output: process.env.NEXT_SKIP_STANDALONE ? undefined : 'standalone',
  transpilePackages: [
    '@frank/pipeline-graph',
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
