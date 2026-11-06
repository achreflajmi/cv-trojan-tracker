import type { NextConfig } from 'next';

// Static export: `next build` writes plain HTML/CSS to out/. No server, no database;
// every number comes from generated/results.json at build time (SPEC 4.1).
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
