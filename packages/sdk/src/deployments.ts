import { getAddress, isAddress, type Address } from 'viem';
import { deploymentFiles } from './deployments.data.js';
import type { Scheme } from './schemes.js';

/** Chains with Qanary deployments: Arbitrum One and Arbitrum Sepolia. */
export type QanaryChainId = 42161 | 421614;

export const ARBITRUM_ONE = 42161 as const;
export const ARBITRUM_SEPOLIA = 421614 as const;

/** ERC-4337 EntryPoint v0.7 (same address on every chain). */
export const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/** Kernel v3.3 infrastructure (same addresses on Arbitrum One and Arbitrum Sepolia). */
export const KERNEL_V3_3_ADDRESSES = {
  implementation: '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28',
  factory: '0x2577507b78c2008Ff367261CB6285d44ba5eF2E9',
  metaFactory: '0xd703aaE79538628d27099B8c4f621bE4CCd142d5',
} as const satisfies Record<string, Address>;

/** Tokens the exposure scanner reads by default on Arbitrum One. */
export const ARBITRUM_ONE_TOKENS = {
  usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  usdg: '0x004B506865409877C9fA29bfb1ebA929984B9bbC',
  weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  arb: '0x912CE59144191C1204E64559FE8253a0e49E6548',
} as const satisfies Record<string, Address>;

/** Contracts of the Qanary core deployment (`evm` section of `deployments/<network>.json`). */
export const CORE_CONTRACTS = [
  'keyStore',
  'quantumValidator',
  'hotTierExecutor',
  'canaryRegistry',
  'drillRegistryFactory',
  'pqSafeOwnerFactory',
  'qanaryAccountFactory',
] as const;
export type CoreContract = (typeof CORE_CONTRACTS)[number];

/**
 * Addresses of one network. Contracts that are not deployed yet are `undefined`; use
 * `requireContract` to get an address or a descriptive error.
 */
export type Deployment = {
  chainId: QanaryChainId;
  network: 'arbitrum-one' | 'arbitrum-sepolia';
  entryPoint: Address;
  kernel: typeof KERNEL_V3_3_ADDRESSES;
  /** ERC-7913 verifier per post-quantum scheme (Stylus programs). */
  verifiers: Partial<Record<Scheme, Address>>;
  ladderVerifier?: Address;
  tokens: Partial<Record<keyof typeof ARBITRUM_ONE_TOKENS, Address>>;
  /** Transaction hashes and addresses recorded by end-to-end runs, as written to the JSON. */
  e2e: Record<string, unknown>;
} & { [K in CoreContract]?: Address };

const NETWORKS: Record<QanaryChainId, Deployment['network']> = {
  42161: 'arbitrum-one',
  421614: 'arbitrum-sepolia',
};

const STYLUS_VERIFIERS: Record<Scheme, string> = {
  mldsa44: 'mldsa44Verifier',
  mldsa65: 'mldsa65Verifier',
  falcon512: 'falcon512Verifier',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionalAddress(value: unknown, where: string): Address | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new Error(`deployments: ${where} is not an address: ${JSON.stringify(value)}`);
  }
  return getAddress(value);
}

/** A Stylus entry is `{ "address": "0x…", … }`; a bare address string is accepted too. */
function stylusAddress(value: unknown, where: string): Address | undefined {
  return optionalAddress(isRecord(value) ? value.address : value, `${where}.address`);
}

/**
 * Builds a `Deployment` from the contents of `deployments/<network>.json` (or `null`/`undefined`
 * when the file does not exist yet: only the shared infrastructure addresses are filled in).
 * Unknown keys are ignored; a malformed address or a mismatching `chainId` throws.
 */
export function parseDeployment(chainId: QanaryChainId, json: unknown): Deployment {
  const network = NETWORKS[chainId];
  if (!network) throw new Error(`deployments: unsupported chain ${chainId}`);
  const d: Deployment = {
    chainId,
    network,
    entryPoint: ENTRY_POINT_V07,
    kernel: KERNEL_V3_3_ADDRESSES,
    verifiers: {},
    tokens: chainId === ARBITRUM_ONE ? { ...ARBITRUM_ONE_TOKENS } : {},
    e2e: {},
  };
  if (json === undefined || json === null) return d;
  if (!isRecord(json)) throw new Error(`deployments: ${network}.json must be a JSON object`);
  if (json.chainId !== undefined && Number(json.chainId) !== chainId) {
    throw new Error(`deployments: ${network}.json has chainId ${String(json.chainId)}, expected ${chainId}`);
  }

  const stylus = isRecord(json.stylus) ? json.stylus : {};
  for (const [scheme, key] of Object.entries(STYLUS_VERIFIERS) as [Scheme, string][]) {
    const address = stylusAddress(stylus[key], `${network}.stylus.${key}`);
    if (address) d.verifiers[scheme] = address;
  }
  d.ladderVerifier = stylusAddress(stylus.ladderVerifier, `${network}.stylus.ladderVerifier`);

  const evm = isRecord(json.evm) ? json.evm : {};
  for (const name of CORE_CONTRACTS) {
    const address = optionalAddress(evm[name], `${network}.evm.${name}`);
    if (address) d[name] = address;
  }
  if (isRecord(json.e2e)) d.e2e = json.e2e;
  return d;
}

/**
 * Qanary deployments by chain id, built from the repository's `deployments/*.json` at build time
 * (`scripts/gen-deployments.ts`). Networks without a deployment file only carry the shared
 * infrastructure (EntryPoint, Kernel) and tokens.
 */
export const deployments: Record<QanaryChainId, Deployment> = {
  42161: parseDeployment(ARBITRUM_ONE, deploymentFiles[ARBITRUM_ONE]),
  421614: parseDeployment(ARBITRUM_SEPOLIA, deploymentFiles[ARBITRUM_SEPOLIA]),
};

/** The deployment for `chainId`; throws for chains Qanary is not deployed on. */
export function getDeployment(chainId: number): Deployment {
  const d = deployments[chainId as QanaryChainId];
  if (!d) throw new Error(`no Qanary deployment for chain ${chainId} (supported: 42161, 421614)`);
  return d;
}

/** The address of `name` in `d`, or a descriptive error if it is not deployed there. */
export function requireContract(d: Deployment, name: CoreContract): Address {
  const address = d[name];
  if (!address) throw new Error(`${name} is not deployed on ${d.network} (deployments/${d.network}.json)`);
  return address;
}

/** The ERC-7913 verifier for `scheme` in `d`, or a descriptive error if it is not deployed there. */
export function requireVerifier(d: Deployment, scheme: Scheme): Address {
  const address = d.verifiers[scheme];
  if (!address) throw new Error(`no ${scheme} verifier deployed on ${d.network} (deployments/${d.network}.json)`);
  return address;
}
