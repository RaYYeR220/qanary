/** Helpers shared by the SDK scripts (Node only). */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, http, type Chain, type Hex } from 'viem';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import { parseDeployment, type Deployment, type QanaryChainId } from '../src/deployments.js';

const here = dirname(fileURLToPath(import.meta.url));

export const NETWORKS = {
  'arbitrum-one': { chain: arbitrum, chainId: 42161, rpcEnv: 'ARB_ONE_RPC', defaultRpc: 'https://arb1.arbitrum.io/rpc' },
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    chainId: 421614,
    rpcEnv: 'ARB_SEPOLIA_RPC',
    defaultRpc: 'https://sepolia-rollup.arbitrum.io/rpc',
  },
} as const satisfies Record<string, { chain: Chain; chainId: QanaryChainId; rpcEnv: string; defaultRpc: string }>;
export type NetworkName = keyof typeof NETWORKS;

export function deploymentPath(network: NetworkName): string {
  return resolve(here, '../../../deployments', `${network}.json`);
}

/** Reads `deployments/<network>.json` from disk (fresh, not the copy embedded at build time). */
export function readDeploymentFile(network: NetworkName): { json: Record<string, unknown>; deployment: Deployment } | undefined {
  const path = deploymentPath(network);
  if (!existsSync(path)) return undefined;
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  return { json, deployment: parseDeployment(NETWORKS[network].chainId, json) };
}

/** Merges `values` into `e2e[section]` of `deployments/<network>.json` and writes it back. */
export function recordE2E(network: NetworkName, section: string, values: Record<string, unknown>): void {
  const path = deploymentPath(network);
  const json = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  const e2e = (json.e2e ?? {}) as Record<string, unknown>;
  e2e[section] = { ...((e2e[section] ?? {}) as Record<string, unknown>), ...values };
  json.e2e = e2e;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

export function rpcUrl(network: NetworkName): string {
  const n = NETWORKS[network];
  return process.env[n.rpcEnv] || n.defaultRpc;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
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
