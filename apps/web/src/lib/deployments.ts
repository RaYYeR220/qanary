// Reads the repository's deployments/<network>.json at build time against a
// strict schema. A missing file means "deploying"; a malformed one fails the
// build, so the page can never print an address or transaction that is not in
// the records.

import fs from 'node:fs';
import path from 'node:path';

export type NetworkKey = 'apechain' | 'apechain-curtis' | 'arbitrum-one';

export interface Network {
  key: NetworkKey;
  name: string;
  chainId: number;
  explorer: string;
  /** Whether new Stylus programs can be activated there today. */
  stylus: 'live' | 'paused';
}

/** ApeChain first: it is where the Stylus verifiers run on mainnet. */
export const NETWORKS: Network[] = [
  { key: 'apechain', name: 'ApeChain', chainId: 33139, explorer: 'https://apescan.io', stylus: 'live' },
  { key: 'apechain-curtis', name: 'ApeChain Curtis', chainId: 33111, explorer: 'https://curtis.apescan.io', stylus: 'live' },
  { key: 'arbitrum-one', name: 'Arbitrum One', chainId: 42161, explorer: 'https://arbiscan.io', stylus: 'paused' },
];

/** Stylus programs, by their key under `stylus` in the records. */
export const STYLUS_LABELS = {
  mldsa44Verifier: 'ML-DSA-44 verifier',
  mldsa65Verifier: 'ML-DSA-65 verifier',
  falcon512Verifier: 'Falcon-512 verifier',
  ladderVerifier: 'Tripwire ladder verifier',
} as const;
export type StylusKey = keyof typeof STYLUS_LABELS;
export const STYLUS_KEYS = Object.keys(STYLUS_LABELS) as StylusKey[];

/** Solidity contracts, by their key under `evm` (the SDK's core contract names). */
export const EVM_LABELS: Record<string, string> = {
  keyStore: 'Key store',
  quantumValidator: 'Quantum validator',
  hotTierExecutor: 'Hot-tier executor',
  canaryRegistry: 'Tripwire registry',
  drillRegistryFactory: 'Drill registry factory',
  qanaryAccountFactory: 'Account factory',
  pqSafeOwnerFactory: 'Safe owner factory',
  mldsa44SolidityVerifier: 'ML-DSA-44 verifier (Solidity)',
  solidityMldsa44Verifier: 'ML-DSA-44 verifier (Solidity)',
  mldsa44VerifierCore: 'ML-DSA-44 verifier core (Solidity)',
  mldsa44ExpandedKeyStore: 'ML-DSA-44 expanded-key store',
  keccakF1600Helper: 'Keccak-f[1600] helper',
  ladderUnavailable: 'Ladder stand-in (fails closed)',
};

/** Where the Solidity ML-DSA-44 verifier may be recorded, in order of preference. */
export const FALLBACK_VERIFIER_PATHS = [
  ['evm', 'mldsa44SolidityVerifier'],
  ['evm', 'solidityMldsa44Verifier'],
  ['fallback', 'solidityMldsa44Verifier'],
] as const;

export type Hex = `0x${string}`;

export interface Tx {
  label: string;
  hash: Hex;
  href: string;
  /** For a transaction recorded as an intended refusal: the error it reverted with, as recorded. */
  error?: string;
}

/** An account the live run left on-chain, with how it signs. */
export interface Hero {
  label: string;
  address: Hex;
  key: string;
}

export interface Contract {
  key: string;
  label: string;
  address: Hex;
  href: string;
  txs: Tx[];
  sizeBytes?: number;
  /** Live gas for one verification call, calldata included. */
  verifyCallGas?: number;
  /** Ladder verifier only: live gas by curve. */
  gasByCurve?: Record<string, number>;
}

export interface NetworkRecord {
  network: Network;
  /** False when there is no record file yet. */
  present: boolean;
  stylus: Partial<Record<StylusKey, Contract>>;
  evm: Contract[];
  e2e: Tx[];
  /** The Solidity ML-DSA-44 verifier, where Stylus activations are paused. */
  fallbackVerifier?: Hex;
  /** The validated record, as read; handed to the SDK's `parseDeployment` in the browser. */
  json?: Record<string, unknown>;
  heroes?: Hero[];
  /** Fixed points of the live run a page can replay. */
  run?: { rootKeyPointer?: Hex; pqUserOpHash?: Hex; pqUserOpTx?: Hex; drillRegistry?: Hex; hotKey?: Hex };
}

export class DeploymentError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'DeploymentError';
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = /^0x0{40}$/i;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const TX_LABELS: Record<string, string> = {
  deployTx: 'deployment',
  activationTx: 'activation',
  // the live end-to-end run (`e2e.sdk`)
  storeKeyTx: 'Root key stored in the key store',
  prepareKeyTx: 'Root key prepared for the Solidity verifier',
  fundAccountTx: 'Treasury funded for its first operation',
  pqUserOpTx: 'Treasury deployed by its first post-quantum operation',
  pqTransferTx: 'Transfer signed with the post-quantum key',
  installHotTierTx: 'Hot tier installed',
  hotTransferTx: 'Hot-key transfer inside the cap',
  hotOverCapRevertTx: 'Hot-key transfer over the cap',
  tamperedSigRevertTx: 'Operation with a tampered signature',
  drillRegistryTx: 'Drill registry created',
  repointHotTierTx: 'Hot tier pointed at the drill registry',
  ladderL1ClaimTx: 'Drill: ladder rung L1 claimed',
  ladderL1RevertTx: 'Drill: ladder claim where no ladder verifier runs',
  drillClaimTx: 'Drill: secp256k1 claimed',
  postTripHotRevertTx: 'Hot-key transfer after the trip',
  mnemonicStoreKeyTx: 'Recovery-phrase key stored',
  mnemonicFundTx: 'Recovery-phrase treasury funded',
  mnemonicUserOpTx: 'Recovery-phrase treasury deployed',
  falconStoreKeyTx: 'Falcon-512 key stored',
  falconFundTx: 'Falcon-512 treasury funded',
  falconUserOpTx: 'Falcon-512 treasury deployed',
};
function txLabel(key: string): string {
  if (TX_LABELS[key]) return TX_LABELS[key];
  const words = key.replace(/Tx$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words;
}

/** Validates one network's record. Throws DeploymentError on anything malformed. */
export function parseRecord(network: Network, json: unknown, file = `${network.key}.json`): NetworkRecord {
  const fail = (m: string): never => {
    throw new DeploymentError(file, m);
  };
  if (!isObject(json)) fail('expected a JSON object');
  const doc = json as Record<string, unknown>;
  if (doc.network !== network.key) fail(`"network" is ${JSON.stringify(doc.network)}, expected "${network.key}"`);
  if (doc.chainId !== network.chainId) fail(`"chainId" is ${JSON.stringify(doc.chainId)}, expected ${network.chainId}`);

  const address = (v: unknown, at: string): Hex => {
    if (typeof v !== 'string' || !ADDRESS.test(v)) fail(`${at} is not an address`);
    if (ZERO.test(v as string)) fail(`${at} is the zero address`);
    return v as Hex;
  };
  // only fields named *Tx are transactions
  // a `<name>RevertTx` pairs with the `<prefix>Error` recorded beside it
  const errorFor = (o: Record<string, unknown>, key: string): string | undefined => {
    if (!key.endsWith('RevertTx')) return undefined;
    const stem = key.slice(0, -'RevertTx'.length);
    const exact = o[`${stem}Error`];
    if (typeof exact === 'string') return exact;
    const near = Object.entries(o).find(([k, v]) => k.endsWith('Error') && typeof v === 'string' && stem.startsWith(k.slice(0, -'Error'.length)));
    return near ? (near[1] as string) : 'reverted';
  };
  const txs = (o: Record<string, unknown>, at: string): Tx[] =>
    Object.entries(o)
      .filter(([k]) => k.endsWith('Tx'))
      .map(([k, v]) => {
        if (typeof v !== 'string' || !HASH.test(v)) fail(`${at}.${k} is not a transaction hash`);
        const error = errorFor(o, k);
        return { label: txLabel(k), hash: v as Hex, href: `${network.explorer}/tx/${v}`, ...(error ? { error } : {}) };
      });
  const num = (v: unknown, at: string): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${at} is not a non-negative number`);
    return v as number;
  };
  const contract = (key: string, label: string, v: unknown, at: string): Contract => {
    if (!isObject(v)) fail(`${at} must be an object`);
    const o = v as Record<string, unknown>;
    const addr = address(o.address, `${at}.address`);
    const c: Contract = { key, label, address: addr, href: `${network.explorer}/address/${addr}`, txs: txs(o, at) };
    const size = num(o.sizeBytes, `${at}.sizeBytes`);
    if (size !== undefined) c.sizeBytes = size;
    const gas = num(o.verifyCallGas, `${at}.verifyCallGas`);
    if (gas !== undefined) c.verifyCallGas = gas;
    const verify = o.verify;
    if (isObject(verify) && verify.gasByCurve !== undefined) {
      if (!isObject(verify.gasByCurve)) fail(`${at}.verify.gasByCurve must be an object`);
      c.gasByCurve = Object.fromEntries(
        Object.entries(verify.gasByCurve as Record<string, unknown>).map(([k, g]) => [k, num(g, `${at}.verify.gasByCurve.${k}`)!]),
      );
    }
    return c;
  };

  const stylus: NetworkRecord['stylus'] = {};
  if (doc.stylus !== undefined) {
    if (!isObject(doc.stylus)) fail('"stylus" must be an object');
    for (const [k, v] of Object.entries(doc.stylus as Record<string, unknown>)) {
      if (!(k in STYLUS_LABELS)) fail(`unknown Stylus program "${k}"`);
      stylus[k as StylusKey] = contract(k, STYLUS_LABELS[k as StylusKey], v, `stylus.${k}`);
    }
  }
  const evm: Contract[] = [];
  if (doc.evm !== undefined) {
    if (!isObject(doc.evm)) fail('"evm" must be an object');
    for (const [k, v] of Object.entries(doc.evm as Record<string, unknown>)) {
      // the SDK records core contracts as bare addresses; other tools as { address, ...Tx }
      evm.push(contract(k, EVM_LABELS[k] ?? k, isObject(v) ? v : { address: v }, `evm.${k}`));
    }
  }
  // end-to-end runs nest their records (`e2e.sdk.pqUserOpTx`); only *Tx fields are transactions
  const e2e: Tx[] = [];
  const walk = (o: Record<string, unknown>, at: string) => {
    e2e.push(...txs(o, at));
    for (const [k, v] of Object.entries(o)) if (isObject(v)) walk(v, `${at}.${k}`);
  };
  if (doc.e2e !== undefined) {
    if (!isObject(doc.e2e)) fail('"e2e" must be an object');
    walk(doc.e2e as Record<string, unknown>, 'e2e');
  }
  let fallbackVerifier: Hex | undefined;
  for (const [section, key] of FALLBACK_VERIFIER_PATHS) {
    const sec = doc[section];
    if (!isObject(sec) || sec[key] === undefined) continue;
    const v = sec[key];
    fallbackVerifier = address(isObject(v) ? v.address : v, `${section}.${key}`);
    break;
  }
  // the treasuries the live run opened, and what a page needs to replay its checks
  const heroes: Hero[] = [];
  let run: NetworkRecord['run'];
  const sdk = isObject(doc.e2e) && isObject((doc.e2e as Record<string, unknown>).sdk) ? ((doc.e2e as Record<string, unknown>).sdk as Record<string, unknown>) : null;
  if (sdk) {
    const opt = (k: string) => (sdk[k] === undefined ? undefined : address(sdk[k], `e2e.sdk.${k}`));
    const hash = (k: string) => {
      const v = sdk[k];
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || !HASH.test(v)) fail(`e2e.sdk.${k} is not a 32-byte hash`);
      return v as Hex;
    };
    const kms = opt('kernelAccount');
    if (kms) heroes.push({ label: 'Treasury with an AWS KMS root key', address: kms, key: 'ML-DSA-44 in an AWS KMS HSM' });
    const mn = opt('mnemonicKernelAccount');
    if (mn) heroes.push({ label: 'Treasury from a recovery phrase', address: mn, key: 'ML-DSA-44 from a recovery phrase' });
    const fa = opt('falconKernelAccount');
    if (fa) heroes.push({ label: 'Falcon-512 treasury', address: fa, key: 'Falcon-512 from a recovery phrase' });
    run = {
      ...(opt('rootKeyPointer') ? { rootKeyPointer: opt('rootKeyPointer')! } : {}),
      ...(hash('pqUserOpHash') ? { pqUserOpHash: hash('pqUserOpHash')! } : {}),
      ...(hash('pqUserOpTx') ? { pqUserOpTx: hash('pqUserOpTx')! } : {}),
      ...(opt('drillRegistry') ? { drillRegistry: opt('drillRegistry')! } : {}),
      ...(opt('hotKey') ? { hotKey: opt('hotKey')! } : {}),
    };
  }
  return {
    network,
    present: true,
    stylus,
    evm,
    e2e,
    heroes,
    ...(run ? { run } : {}),
    ...(fallbackVerifier ? { fallbackVerifier } : {}),
    json: doc,
  };
}

export const emptyRecord = (network: Network): NetworkRecord => ({ network, present: false, stylus: {}, evm: [], e2e: [], heroes: [] });

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/** All networks' records. Missing files read as "deploying"; malformed files throw. */
export function readDeployments(dir = path.join(repoRoot(), 'deployments')): NetworkRecord[] {
  return NETWORKS.map((n) => {
    const file = path.join(dir, `${n.key}.json`);
    if (!fs.existsSync(file)) return emptyRecord(n);
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new DeploymentError(`${n.key}.json`, `invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    return parseRecord(n, json);
  });
}

export const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** What a product page needs to know about a network, serialisable for the browser. */
export interface ProductNetwork {
  key: NetworkKey;
  name: string;
  chainId: number;
  explorer: string;
  rpc: string;
  nativeSymbol: string;
  stylus: Network['stylus'];
  /** Validated deployment record, or null while nothing is deployed there. */
  json: Record<string, unknown> | null;
  fallbackVerifier: Hex | null;
  heroes: Hero[];
  run: NonNullable<NetworkRecord['run']> | null;
  /** Transaction that deployed the account modules: logs start no earlier than its block. */
  modulesTx: Hex | null;
  e2e: Tx[];
}

const RPC: Record<NetworkKey, { rpc: string; nativeSymbol: string }> = {
  apechain: { rpc: 'https://rpc.apechain.com/http', nativeSymbol: 'APE' },
  'apechain-curtis': { rpc: 'https://rpc.curtis.apechain.com', nativeSymbol: 'APE' },
  'arbitrum-one': { rpc: 'https://arb1.arbitrum.io/rpc', nativeSymbol: 'ETH' },
};

/** The product's networks, read from the records at build time. */
export function productNetworks(records: NetworkRecord[] = readDeployments()): ProductNetwork[] {
  // the SDK reads `evm` entries as bare addresses; hand it those whatever the record's style
  const normalise = (json: Record<string, unknown> | undefined) => {
    if (!json) return null;
    const evm = json.evm;
    if (!isObject(evm)) return json;
    return {
      ...json,
      evm: Object.fromEntries(Object.entries(evm).map(([k, v]) => [k, isObject(v) ? v.address : v])),
    };
  };
  return records.map((r) => ({
    key: r.network.key,
    name: r.network.name,
    chainId: r.network.chainId,
    explorer: r.network.explorer,
    rpc: RPC[r.network.key].rpc,
    nativeSymbol: RPC[r.network.key].nativeSymbol,
    stylus: r.network.stylus,
    json: normalise(r.json),
    fallbackVerifier: r.fallbackVerifier ?? null,
    heroes: r.heroes ?? [],
    run: r.run ?? null,
    modulesTx: r.evm.find((c) => c.key === 'keyStore')?.txs.find((t) => t.label === 'deployment')?.hash ?? null,
    e2e: r.e2e,
  }));
}
