// Reads deployment records from the repository's deployments/*.json at build
// time. Nothing is shown as deployed unless an address or transaction hash is
// actually in those files; every other slot prints as "deploying".

import fs from 'node:fs';
import path from 'node:path';

export interface Network {
  key: 'arbitrum-one' | 'arbitrum-sepolia';
  name: string;
  explorer: string;
}

export const NETWORKS: Network[] = [
  { key: 'arbitrum-one', name: 'Arbitrum One', explorer: 'https://arbiscan.io' },
  { key: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', explorer: 'https://sepolia.arbiscan.io' },
];

/** The contracts the register always lists, matched to keys in the JSON. */
export const REGISTER: { label: string; detail: string; match: RegExp }[] = [
  { label: 'ML-DSA-44 verifier', detail: 'Stylus', match: /ml.?dsa.?44|mldsa44/i },
  { label: 'ML-DSA-65 verifier', detail: 'Stylus', match: /ml.?dsa.?65|mldsa65/i },
  { label: 'Falcon-512 verifier', detail: 'Stylus', match: /falcon/i },
  { label: 'Tripwire registry', detail: 'Canary bounties', match: /canary|tripwire|registry/i },
  { label: 'Quantum validator', detail: 'Kernel module', match: /validator/i },
  { label: 'Hot-tier executor', detail: 'Capped spending', match: /executor|hot.?tier/i },
  { label: 'Key store', detail: 'Post-quantum public keys', match: /key.?store/i },
];

export interface Entry {
  key: string;
  label: string;
  value: `0x${string}`;
  href: string;
}

export interface NetworkRecord {
  network: Network;
  contracts: { label: string; detail: string; entry: Entry | null }[];
  transactions: Entry[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

function humanize(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Walks a JSON value and collects addresses and transaction hashes by key path. */
export function collect(json: unknown, prefix = ''): { addresses: [string, string][]; txs: [string, string][] } {
  const addresses: [string, string][] = [];
  const txs: [string, string][] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'string') {
      if (ADDRESS.test(v)) addresses.push([at, v]);
      else if (TX.test(v)) txs.push([at, v]);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}.${i}`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
    }
  };
  walk(json, prefix);
  return { addresses, txs };
}

export function recordFrom(network: Network, json: unknown): NetworkRecord {
  const { addresses, txs } = collect(json);
  // well-known third-party contracts are not ours to list
  const ours = addresses.filter(([k]) => !/entry.?point|ecdsa|kernel(?!.*validator)|safe.?singleton|usdg|cache.?manager|deployer|owner|council/i.test(k));
  const used = new Set<string>();
  const contracts = REGISTER.map((r) => {
    const hit = ours.find(([k]) => !used.has(k) && r.match.test(k));
    if (!hit) return { label: r.label, detail: r.detail, entry: null };
    used.add(hit[0]);
    return {
      label: r.label,
      detail: r.detail,
      entry: { key: hit[0], label: r.label, value: hit[1] as `0x${string}`, href: `${network.explorer}/address/${hit[1]}` },
    };
  });
  const transactions = txs.map(([k, v]) => ({
    key: k,
    label: humanize(k),
    value: v as `0x${string}`,
    href: `${network.explorer}/tx/${v}`,
  }));
  return { network, contracts, transactions };
}

function repoRoot(): string {
  // apps/web at build and dev time; fall back to walking up for other layouts
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function readDeployments(): NetworkRecord[] {
  const dir = path.join(repoRoot(), 'deployments');
  return NETWORKS.map((n) => {
    const file = path.join(dir, `${n.key}.json`);
    let json: unknown = {};
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      json = {};
    }
    return recordFrom(n, json);
  });
}

export const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
