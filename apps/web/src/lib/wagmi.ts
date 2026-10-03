'use client';

import { http } from 'viem';
import { createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { NETWORKS } from './sdk';
import { viemChain } from './chain';

const KEYS = ['apechain', 'apechain-curtis', 'arbitrum-one'] as const;

/** The three networks the product runs on, built from the SDK's network table. */
export const PRODUCT_CHAINS = KEYS.map((k) => {
  const n = NETWORKS[k]!;
  return viemChain({ chainId: n.chainId, name: n.label, rpc: n.rpc, explorer: n.explorer, nativeSymbol: n.nativeSymbol });
}) as [ReturnType<typeof viemChain>, ...ReturnType<typeof viemChain>[]];

export const wagmiConfig = createConfig({
  chains: PRODUCT_CHAINS,
  connectors: [injected()],
  transports: Object.fromEntries(PRODUCT_CHAINS.map((c) => [c.id, http(c.rpcUrls.default.http[0])])),
  ssr: true,
});
