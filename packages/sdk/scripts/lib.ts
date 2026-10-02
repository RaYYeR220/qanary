/** Helpers shared by the SDK scripts (Node only). */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, defineChain, http, type Chain, type Hex } from 'viem';
import { parseDeployment, type Deployment } from '../src/deployments.js';
import { NETWORKS, networkByName, type Network } from '../src/networks.js';

const here = dirname(fileURLToPath(import.meta.url));
/** Root of the repository (holds `deployments/` and the git-ignored `.secrets/`). */
export const REPO_ROOT = resolve(here, '../../..');

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

/** Value of `--flag <value>` in argv. */
export function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function resolveNetwork(name: string | undefined): Network {
  const known = Object.keys(NETWORKS).join(' | ');
  if (!name) fail(`missing network (${known})`);
  return networkByName(name) ?? fail(`unknown network ${name} (${known})`);
}

/** RPC URL: `<NAME>_RPC` from the environment (ARB_ONE_RPC / ARB_SEPOLIA_RPC for Arbitrum), else the public default. */
export function rpcUrl(n: Network): string {
  const env: Record<string, string> = { 'arbitrum-one': 'ARB_ONE_RPC', 'arbitrum-sepolia': 'ARB_SEPOLIA_RPC' };
  const name = env[n.name] ?? `${n.name.toUpperCase().replaceAll('-', '_')}_RPC`;
  return process.env[name] || n.rpc;
}

export function chainFor(n: Network): Chain {
  return defineChain({
    id: n.chainId,
    name: n.label,
    nativeCurrency: { name: n.nativeSymbol, symbol: n.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl(n)] } },
    blockExplorers: { default: { name: 'Explorer', url: n.explorer } },
  });
}

export function deploymentPath(n: Network): string {
  return resolve(REPO_ROOT, 'deployments', `${n.name}.json`);
}

/** Reads `deployments/<network>.json` from disk (fresh, not the copy embedded at build time). */
export function readDeploymentFile(n: Network): { json: Record<string, unknown>; deployment: Deployment } | undefined {
  const path = deploymentPath(n);
  if (!existsSync(path)) return undefined;
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  return { json, deployment: parseDeployment(n.chainId, json) };
}

/** Merges `values` into `e2e[section]` of `deployments/<network>.json` and writes it back. */
export function recordE2E(n: Network, section: string, values: Record<string, unknown>): void {
  const path = deploymentPath(n);
  const json = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  const e2e = (json.e2e ?? {}) as Record<string, unknown>;
  e2e[section] = { ...((e2e[section] ?? {}) as Record<string, unknown>), ...values };
  json.e2e = e2e;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

/**
 * A secret for a script run: from the environment, else from `.secrets/<file>` (KEY=value lines),
 * else created with `create` and appended to that file. Secrets are never printed.
 */
export function secret(file: string, name: string, create: () => string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const path = resolve(REPO_ROOT, '.secrets', file);
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0 && line.slice(0, eq).trim() === name) return line.slice(eq + 1).trim();
    }
  }
  const value = create();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${name}=${value}\n`, { mode: 0o600 });
  console.log(`created ${name} in ${relative(REPO_ROOT, path)} (git-ignored)`);
  return value;
}

type GasPrice = { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };

/**
 * User-operation gas price from the bundler: `pimlico_getUserOperationGasPrice` (Pimlico/Alto)
 * or `zd_getUserOperationGasPrice` (ZeroDev), "fast" tier.
 */
export async function bundlerGasPrice(
  bundlerUrl: string,
  kind: 'pimlico' | 'zerodev',
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const client = createClient({ transport: http(bundlerUrl) });
  const method = kind === 'pimlico' ? 'pimlico_getUserOperationGasPrice' : 'zd_getUserOperationGasPrice';
  const res = (await client.request({ method, params: [] } as never)) as { fast: GasPrice };
  return { maxFeePerGas: BigInt(res.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(res.fast.maxPriorityFeePerGas) };
}
