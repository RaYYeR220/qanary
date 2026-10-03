'use client';

// Browser-side access to the product's networks: viem chains and public
// clients, and the SDK deployment for each, built from the validated records.

import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';
import type { ProductNetwork } from './deployments';
import { parseDeployment, type Deployment } from './sdk';

export type { ProductNetwork };

export function viemChain(n: Pick<ProductNetwork, 'chainId' | 'name' | 'rpc' | 'explorer' | 'nativeSymbol'>): Chain {
  return defineChain({
    id: n.chainId,
    name: n.name,
    nativeCurrency: { name: n.nativeSymbol, symbol: n.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [n.rpc] } },
    blockExplorers: { default: { name: 'Explorer', url: n.explorer } },
  });
}

const clients = new Map<number, PublicClient>();

export function publicClientFor(n: ProductNetwork): PublicClient {
  let c = clients.get(n.chainId);
  if (!c) {
    c = createPublicClient({ chain: viemChain(n), transport: http(n.rpc, { batch: true, retryCount: 2 }) }) as PublicClient;
    clients.set(n.chainId, c);
  }
  return c;
}

/**
 * The SDK deployment for a network. Where Stylus activations are paused, the
 * Solidity ML-DSA-44 verifier stands in for the Stylus one behind the same
 * ERC-7913 interface.
 */
export function deploymentOf(n: ProductNetwork): Deployment {
  const d = parseDeployment(n.chainId, n.json);
  if (n.fallbackVerifier && !d.verifiers.mldsa44) d.verifiers.mldsa44 = n.fallbackVerifier;
  return d;
}

export const explorerAddress = (n: ProductNetwork, a: string) => `${n.explorer}/address/${a}`;
export const explorerTx = (n: ProductNetwork, h: string) => `${n.explorer}/tx/${h}`;
