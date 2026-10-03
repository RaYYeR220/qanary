import { getAddress, isAddress, type Address } from 'viem';
import { deploymentFiles } from './deployments.data.js';
import { NETWORKS, networkByChainId } from './networks.js';
import type { Scheme } from './schemes.js';

/** ERC-4337 EntryPoint v0.7 (same address on every chain). */
export const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/** Kernel v3.3 infrastructure at its canonical (CREATE2) addresses; the default on every chain. */
export const KERNEL_V3_3_ADDRESSES = {
  implementation: '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28',
  factory: '0x2577507b78c2008Ff367261CB6285d44ba5eF2E9',
  metaFactory: '0xd703aaE79538628d27099B8c4f621bE4CCd142d5',
} as const satisfies Record<string, Address>;

export type KernelAddresses = { implementation: Address; factory: Address; metaFactory: Address };

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
  chainId: number;
  /** Network slug (`arbitrum-one`, `apechain`, …), also the deployment file name. */
  network: string;
  nativeSymbol: string;
  entryPoint: Address;
  kernel: KernelAddresses;
  /**
   * ERC-7913 verifier per post-quantum scheme: the Stylus programs, or for ML-DSA-44 the Solidity
   * fallback (`evm.mldsa44SolidityVerifier`) where no Stylus program is recorded.
   */
  verifiers: Partial<Record<Scheme, Address>>;
  ladderVerifier?: Address;
  /** Tokens read by default by the exposure scanner. */
  tokens: Record<string, Address>;
  /** Transaction hashes and addresses recorded by end-to-end runs, as written to the JSON. */
  e2e: Record<string, unknown>;
} & { [K in CoreContract]?: Address };

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

/** A contract entry is `{ "address": "0x…", … }`; a bare address string is accepted too. */
function stylusAddress(value: unknown, where: string): Address | undefined {
  return isRecord(value) ? optionalAddress(value.address, `${where}.address`) : optionalAddress(value, where);
}

/**
 * Builds a `Deployment` for `chainId` from the contents of `deployments/<network>.json`, or from
 * `null`/`undefined` when the file does not exist yet (only the shared infrastructure is filled
 * in). Known networks take their name, native currency and tokens from `NETWORKS`; other chains
 * get `chain-<id>`, ETH and no tokens. The file may override `entryPoint` and `kernel`
 * (`implementation`, `factory`, `metaFactory`). Unknown keys are ignored; a malformed address or a
 * mismatching `chainId` throws.
 */
export function parseDeployment(chainId: number, json: unknown): Deployment {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`deployments: invalid chain id ${chainId}`);
  const known = networkByChainId(chainId);
  const network = known?.name ?? `chain-${chainId}`;
  const d: Deployment = {
    chainId,
    network,
    nativeSymbol: known?.nativeSymbol ?? 'ETH',
    entryPoint: ENTRY_POINT_V07,
    kernel: { ...KERNEL_V3_3_ADDRESSES },
    verifiers: {},
    tokens: { ...(known?.tokens ?? {}) },
    e2e: {},
  };
  if (json === undefined || json === null) return d;
  if (!isRecord(json)) throw new Error(`deployments: ${network}.json must be a JSON object`);
  if (json.chainId !== undefined && Number(json.chainId) !== chainId) {
    throw new Error(`deployments: ${network}.json has chainId ${String(json.chainId)}, expected ${chainId}`);
  }

  d.entryPoint = optionalAddress(json.entryPoint, `${network}.entryPoint`) ?? d.entryPoint;
  const kernel = isRecord(json.kernel) ? json.kernel : {};
  for (const key of ['implementation', 'factory', 'metaFactory'] as const) {
    d.kernel[key] = optionalAddress(kernel[key], `${network}.kernel.${key}`) ?? d.kernel[key];
  }

  const stylus = isRecord(json.stylus) ? json.stylus : {};
  for (const [scheme, key] of Object.entries(STYLUS_VERIFIERS) as [Scheme, string][]) {
    const address = stylusAddress(stylus[key], `${network}.stylus.${key}`);
    if (address) d.verifiers[scheme] = address;
  }
  d.ladderVerifier = stylusAddress(stylus.ladderVerifier, `${network}.stylus.ladderVerifier`);

  const evm = isRecord(json.evm) ? json.evm : {};
  for (const name of CORE_CONTRACTS) {
    const address = stylusAddress(evm[name], `${network}.evm.${name}`);
    if (address) d[name] = address;
  }
  // Chains without Stylus activations run the Solidity ML-DSA-44 verifier instead.
  const fallback = stylusAddress(evm.mldsa44SolidityVerifier, `${network}.evm.mldsa44SolidityVerifier`);
  if (fallback && !d.verifiers.mldsa44) d.verifiers.mldsa44 = fallback;
  if (isRecord(json.e2e)) d.e2e = json.e2e;
  return d;
}

/**
 * Qanary deployments by chain id: one entry per known network (`NETWORKS`), built from the
 * repository's `deployments/<network>.json` at build time (`scripts/gen-deployments.ts`).
 * Networks without a deployment file only carry the shared infrastructure (EntryPoint, Kernel).
 */
export const deployments: Record<number, Deployment> = Object.fromEntries(
  Object.values(NETWORKS).map((n) => [n.chainId, parseDeployment(n.chainId, deploymentFiles[n.name])]),
);

/** The deployment for `chainId`; throws for chains Qanary has no network entry for. */
export function getDeployment(chainId: number): Deployment {
  const d = deployments[chainId];
  if (!d) {
    const known = Object.values(NETWORKS)
      .map((n) => `${n.chainId} ${n.name}`)
      .join(', ');
    throw new Error(`no Qanary deployment for chain ${chainId} (known: ${known})`);
  }
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
