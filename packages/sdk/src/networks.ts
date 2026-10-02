import type { Address } from 'viem';

/**
 * A network Qanary knows about: identity, native currency, explorer, default public RPC, the
 * tokens the exposure scanner reads by default, and whether Pimlico's public ERC-4337 bundler
 * (`https://public.pimlico.io/v2/<chainId>/rpc`) serves it.
 */
export type Network = {
  /** Slug, also the deployment file name (`deployments/<name>.json`). */
  name: string;
  chainId: number;
  label: string;
  nativeSymbol: string;
  explorer: string;
  rpc: string;
  tokens: Record<string, Address>;
  pimlicoPublic: boolean;
};

/** Tokens the exposure scanner reads by default on Arbitrum One. */
export const ARBITRUM_ONE_TOKENS = {
  usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  usdg: '0x004B506865409877C9fA29bfb1ebA929984B9bbC',
  weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  arb: '0x912CE59144191C1204E64559FE8253a0e49E6548',
} as const satisfies Record<string, Address>;

/** Known networks, keyed by slug. Adding a chain is adding an entry here. */
export const NETWORKS: Record<string, Network> = {
  'arbitrum-one': {
    name: 'arbitrum-one',
    chainId: 42161,
    label: 'Arbitrum One',
    nativeSymbol: 'ETH',
    explorer: 'https://arbiscan.io',
    rpc: 'https://arb1.arbitrum.io/rpc',
    tokens: ARBITRUM_ONE_TOKENS,
    pimlicoPublic: true,
  },
  apechain: {
    name: 'apechain',
    chainId: 33139,
    label: 'ApeChain',
    nativeSymbol: 'APE',
    explorer: 'https://apescan.io',
    rpc: 'https://rpc.apechain.com/http',
    tokens: {},
    pimlicoPublic: false,
  },
  'apechain-curtis': {
    name: 'apechain-curtis',
    chainId: 33111,
    label: 'ApeChain Curtis',
    nativeSymbol: 'APE',
    explorer: 'https://curtis.apescan.io',
    rpc: 'https://rpc.curtis.apechain.com',
    tokens: {},
    pimlicoPublic: false,
  },
  'arbitrum-sepolia': {
    name: 'arbitrum-sepolia',
    chainId: 421614,
    label: 'Arbitrum Sepolia',
    nativeSymbol: 'ETH',
    explorer: 'https://sepolia.arbiscan.io',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    tokens: {},
    pimlicoPublic: true,
  },
};

export function networkByChainId(chainId: number): Network | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}

export function networkByName(name: string): Network | undefined {
  return Object.hasOwn(NETWORKS, name) ? NETWORKS[name] : undefined;
}

/** Symbol of the chain's native currency (`APE` on ApeChain, `ETH` elsewhere and for unknown chains). */
export function nativeSymbol(chainId: number): string {
  return networkByChainId(chainId)?.nativeSymbol ?? 'ETH';
}

/** Explorer link for a transaction, or `undefined` for chains without a known explorer. */
export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const n = networkByChainId(chainId);
  return n ? `${n.explorer}/tx/${hash}` : undefined;
}

/** Pimlico's public bundler endpoint for `chainId`, if Pimlico serves that chain publicly. */
export function pimlicoPublicBundler(chainId: number): string | undefined {
  return networkByChainId(chainId)?.pimlicoPublic ? `https://public.pimlico.io/v2/${chainId}/rpc` : undefined;
}
