import path from 'node:path';
import type { NextConfig } from 'next';

// The pages show a recovery phrase and ask a wallet to send transactions, so nothing may frame them.
// Scripts and styles come from this site only; Next's inline bootstrap needs 'unsafe-inline', and
// the development server also needs eval. Reads go to each network's public RPC over HTTPS.
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' https:${dev ? ' ws:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // the landing page reads deployments/*.json from the repository root at build time
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  // the treasury page renders on demand and reads the deployment records then; the workspace
  // file marks the repository root for the reader
  outputFileTracingIncludes: { '/**': ['../../deployments/*.json', '../../pnpm-workspace.yaml'] },
  turbopack: { root: path.join(import.meta.dirname, '..', '..') },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
