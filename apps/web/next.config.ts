import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // the landing page reads deployments/*.json from the repository root at build time
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  turbopack: { root: path.join(import.meta.dirname, '..', '..') },
};

export default config;
