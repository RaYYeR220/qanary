import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // the landing page reads deployments/*.json from the repository root at build time
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  // the treasury page renders on demand and reads the deployment records then
  outputFileTracingIncludes: { '/app/treasury/[network]/[address]': ['../../deployments/*.json'] },
  turbopack: { root: path.join(import.meta.dirname, '..', '..') },
};

export default config;
