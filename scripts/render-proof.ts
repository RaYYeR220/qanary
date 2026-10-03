/**
 * Renders the deployment tables of PROOF.md, JUDGES.md and README.md from deployments/<network>.json.
 *
 *   node --experimental-strip-types scripts/render-proof.ts [--deployments <dir>] [--check]
 *   npx tsx scripts/render-proof.ts                      (same, on any Node version)
 *
 * PROOF.md is rendered in full. JUDGES.md and README.md keep their prose; only the blocks between
 * `<!-- proof:begin <name> -->` and `<!-- proof:end <name> -->` are replaced. Every address and
 * transaction links to its explorer. An entry that is not in the deployment files renders as
 * "pending", so the tables can be rendered before every deployment exists and rendered again after
 * each one. The output is deterministic (no timestamps): `--check` exits 1 when a file is stale.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, unknown>;

type Network = {
  name: string;
  label: string;
  chainId: number;
  explorer: string;
  role: string;
  /** Expected contracts: label and the JSON paths where a deployment may record them. */
  contracts: Expected[];
  /** Expected end-to-end transactions (keys written by packages/sdk/scripts/e2e.ts). */
  hero: Expected[];
};

type Expected = { label: string; paths: string[]; key?: boolean };

type Entry = {
  path: string;
  address: string;
  deployTx?: string;
  activationTx?: string;
  notes: string[];
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PENDING = 'pending';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

const STYLUS: Expected[] = [
  { label: 'ML-DSA-44 verifier (Stylus)', paths: ['stylus.mldsa44Verifier'], key: true },
  { label: 'ML-DSA-65 verifier (Stylus)', paths: ['stylus.mldsa65Verifier'], key: true },
  { label: 'Falcon-512 verifier (Stylus)', paths: ['stylus.falcon512Verifier'], key: true },
  { label: 'Ladder ECDSA verifier (Stylus)', paths: ['stylus.ladderVerifier'] },
];

const FALLBACK: Expected[] = [
  {
    label: 'ML-DSA-44 verifier (Solidity)',
    paths: [
      'evm.mldsa44SolidityVerifier',
      'fallback.solidityMldsa44Verifier',
      'fallback.verifier',
      'evm.solidityMldsa44Verifier',
      'evm.mldsa44Verifier',
      'solidity.mldsa44Verifier',
    ],
    key: true,
  },
];

const CORE: Expected[] = [
  { label: 'KeyStore', paths: ['evm.keyStore'], key: true },
  { label: 'QuantumValidator', paths: ['evm.quantumValidator'], key: true },
  { label: 'HotTierExecutor', paths: ['evm.hotTierExecutor'], key: true },
  { label: 'QuantumCanaryRegistry', paths: ['evm.canaryRegistry'], key: true },
  { label: 'DrillRegistryFactory', paths: ['evm.drillRegistryFactory'] },
  { label: 'PQSafeOwnerFactory', paths: ['evm.pqSafeOwnerFactory'] },
  { label: 'QanaryAccountFactory', paths: ['evm.qanaryAccountFactory'] },
];

const sdk = (key: string) => [`e2e.sdk.${key}`];

const HERO_START: Expected[] = [
  { label: 'Treasury account (Kernel v3.3) whose root key is an AWS KMS ML-DSA-44 key', paths: sdk('kernelAccount'), key: true },
  { label: 'Root key stored in the KeyStore', paths: sdk('storeKeyTx') },
];

const HERO_ACCOUNT: Expected[] = [
  { label: 'Account deployed by its first post-quantum signed user operation', paths: sdk('pqUserOpTx'), key: true },
  { label: 'Native transfer signed by the post-quantum root key', paths: sdk('pqTransferTx'), key: true },
  { label: 'Hot tier installed by a root user operation', paths: sdk('installHotTierTx'), key: true },
  { label: 'Hot-key transfer inside the cap', paths: sdk('hotTransferTx'), key: true },
  { label: 'Hot-key transfer over the cap, reverted (`CapExceeded`)', paths: sdk('hotOverCapRevertTx'), key: true },
  { label: 'Tampered post-quantum signature, reverted (`AA24 signature error`)', paths: sdk('tamperedSigRevertTx'), key: true },
  { label: 'Drill registry created', paths: sdk('drillRegistryTx') },
  { label: 'Hot tier re-pointed at the drill registry by a root user operation', paths: sdk('repointHotTierTx') },
];

const HERO_TRIP: Expected[] = [
  { label: 'Drill tripwire claim marks secp256k1 broken', paths: sdk('drillClaimTx'), key: true },
  { label: 'Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`)', paths: sdk('postTripHotRevertTx'), key: true },
  { label: 'ERC-1271 `isValidSignature` through Kernel (eth_call)', paths: sdk('erc1271Result') },
];

const APECHAIN_HERO: Expected[] = [
  ...HERO_START,
  ...HERO_ACCOUNT,
  { label: 'Ladder rung L1 (secp160r1) claimed through the Stylus ladder verifier', paths: sdk('ladderL1ClaimTx'), key: true },
  ...HERO_TRIP,
  { label: 'Account with an ML-DSA-44 root from a mnemonic', paths: sdk('mnemonicKernelAccount') },
  { label: 'Its first user operation (deploys it and transfers)', paths: sdk('mnemonicUserOpTx') },
  { label: 'Account with a Falcon-512 root', paths: sdk('falconKernelAccount') },
  { label: 'Its first user operation (deploys it and transfers)', paths: sdk('falconUserOpTx') },
];

const ARBITRUM_ONE_HERO: Expected[] = [
  ...HERO_START,
  { label: 'Root key expanded on-chain for the Solidity verifier (once per key)', paths: sdk('prepareKeyTx') },
  ...HERO_ACCOUNT,
  { label: 'Ladder rung L1 claim fails closed (`LadderUnavailable`)', paths: sdk('ladderL1RevertTx'), key: true },
  ...HERO_TRIP,
];

const NETWORKS: Network[] = [
  {
    name: 'apechain',
    label: 'ApeChain',
    chainId: 33139,
    explorer: 'https://apescan.io',
    role: 'An Arbitrum Orbit L3 that settles to Arbitrum One; it runs the Stylus verifiers and the full module stack.',
    contracts: [...STYLUS, ...CORE],
    hero: APECHAIN_HERO,
  },
  {
    name: 'arbitrum-one',
    label: 'Arbitrum One',
    chainId: 42161,
    explorer: 'https://arbiscan.io',
    role: 'It runs the full module stack on the Solidity ML-DSA-44 verifier while Stylus activations are paused.',
    contracts: [...FALLBACK, ...CORE],
    hero: ARBITRUM_ONE_HERO,
  },
  {
    name: 'apechain-curtis',
    label: 'ApeChain Curtis (testnet)',
    chainId: 33111,
    explorer: 'https://curtis.apescan.io',
    role: 'ApeChain’s testnet, used to rehearse the Stylus deployment.',
    contracts: [STYLUS[0] as Expected],
    hero: [],
  },
];

const PAUSE = [
  '| Evidence | Link |',
  '|---|---|',
  '| Arbitrum One transaction that sets the WASM activation gas to `u64::MAX` | ' +
    '[`0x9eb3…c652`](https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652) |',
  '| Arbitrum Sepolia transaction, same change | ' +
    '[`0x123e…745b`](https://sepolia.arbiscan.io/tx/0x123ec40e38c2e9c51741c767d06fcbabd92c7d2ac40db242bcaeb193ed20745b) |',
  '| Security Council announcement | ' +
    '[Security Council Emergency Action 2-10-2026](https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530) |',
].join('\n');

// ------------------------------------------------------------------ helpers

function args(): { dir: string; check: boolean } {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--deployments');
  const dir = i >= 0 && argv[i + 1] ? resolve(process.cwd(), argv[i + 1] as string) : join(ROOT, 'deployments');
  return { dir, check: argv.includes('--check') };
}

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function load(dir: string, name: string): Json | undefined {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) return undefined;
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(json)) throw new Error(`${path}: expected a JSON object`);
  return json;
}

function at(json: Json | undefined, path: string): unknown {
  let v: unknown = json;
  for (const part of path.split('.')) {
    if (!isRecord(v)) return undefined;
    v = v[part];
  }
  return v;
}

function short(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

function addressLink(n: Network, address: string): string {
  return `[\`${address}\`](${n.explorer}/address/${address})`;
}

function txLink(n: Network, hash: string): string {
  return `[\`${short(hash)}\`](${n.explorer}/tx/${hash})`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): string | undefined {
  return typeof v === 'number' ? v.toLocaleString('en-US') : undefined;
}

/** An address entry: a bare address string or an object with `address` (plus optional details). */
function entryAt(json: Json | undefined, path: string): Entry | undefined {
  const v = at(json, path);
  if (typeof v === 'string') return ADDRESS.test(v) ? { path, address: v, notes: [] } : undefined;
  if (!isRecord(v) || typeof v.address !== 'string' || !ADDRESS.test(v.address)) return undefined;
  const notes: string[] = [];
  const verify = isRecord(v.verify) ? v.verify : undefined;
  const result = str(verify?.result) ?? (verify?.result === true ? 'true' : undefined);
  const byCurve = isRecord(verify?.gasByCurve) ? Object.values(verify.gasByCurve).map(num).filter(Boolean) : [];
  const gas = byCurve.length ? `${byCurve.join(' / ')} gas by curve` : (num(verify?.gas) ?? num(v.verifyCallGas));
  if (result) notes.push(`live \`verify\` → \`${result}\`${gas ? `, ${gas}${byCurve.length ? '' : ' gas'}` : ''}`);
  const size = num(v.sizeBytes);
  if (size) notes.push(`${size} B`);
  const version = num(v.programVersion);
  if (version) notes.push(`Stylus v${version}`);
  return {
    path,
    address: v.address,
    deployTx: str(v.deployTx) ?? str(v.tx) ?? str(v.deploymentTx),
    activationTx: str(v.activationTx),
    notes,
  };
}

/** Every address entry in the deployment's contract sections, keyed by JSON path. */
function allEntries(json: Json | undefined): Map<string, Entry> {
  const out = new Map<string, Entry>();
  if (!json) return out;
  const skip = new Set(['toolchain', 'e2e', 'kernel', 'tokens']);
  for (const [section, value] of Object.entries(json)) {
    if (skip.has(section) || !isRecord(value)) continue;
    for (const key of Object.keys(value)) {
      const path = `${section}.${key}`;
      const e = entryAt(json, path);
      if (e) out.set(path, e);
      else if (isRecord(value[key])) {
        for (const inner of Object.keys(value[key] as Json)) {
          const p = `${path}.${inner}`;
          const ie = entryAt(json, p);
          if (ie) out.set(p, ie);
        }
      }
    }
  }
  return out;
}

function humanize(path: string): string {
  const last = path.split('.').pop() ?? path;
  return `\`${last}\``;
}

/** A recorded value: addresses and transactions link to the explorer; `key` tells a tx from another hash. */
function cell(n: Network, v: unknown, key = 'Tx'): string {
  if (typeof v !== 'string') return v === undefined ? PENDING : `\`${JSON.stringify(v)}\``;
  if (ADDRESS.test(v)) return addressLink(n, v);
  if (HASH.test(v) && key.endsWith('Tx')) return txLink(n, v);
  return `\`${v}\``;
}

// ------------------------------------------------------------------ tables

function contractRows(n: Network, json: Json | undefined): { rows: string[]; found: number } {
  const all = allEntries(json);
  const used = new Set<string>();
  const rows: string[] = [];
  let found = 0;
  const row = (label: string, e: Entry | undefined, expected = true) => {
    if (!e) return rows.push(`| ${label} | ${PENDING} | | |`);
    if (expected) found++;
    used.add(e.path);
    const txs = [e.deployTx && `deploy ${txLink(n, e.deployTx)}`, e.activationTx && `activate ${txLink(n, e.activationTx)}`]
      .filter(Boolean)
      .join('<br>');
    rows.push(`| ${label} | ${addressLink(n, e.address)} | ${txs} | ${e.notes.join(', ')} |`);
  };
  for (const x of n.contracts) {
    const path = x.paths.find((p) => all.has(p));
    row(x.label, path ? all.get(path) : undefined);
  }
  for (const [path, e] of all) if (!used.has(path)) row(humanize(path), e, false);
  return { rows, found };
}

function heroRows(n: Network, json: Json | undefined): string[] {
  const rows: string[] = [];
  const used = new Set<string>();
  for (const x of n.hero) {
    const path = x.paths.find((p) => at(json, p) !== undefined);
    if (path) used.add(path);
    rows.push(`| ${x.label} | ${path ? cell(n, at(json, path)) : PENDING} |`);
  }
  const e2e = at(json, 'e2e');
  if (isRecord(e2e)) {
    for (const [section, values] of Object.entries(e2e)) {
      if (!isRecord(values)) continue;
      for (const [key, v] of Object.entries(values)) {
        const path = `e2e.${section}.${key}`;
        if (used.has(path) || key === 'ranAt' || key.endsWith('UserOpHash') || /KernelIndex$|^kernelIndex$/.test(key)) continue;
        rows.push(`| ${humanize(path)} | ${cell(n, v, key)} |`);
      }
    }
  }
  return rows;
}

function networkSection(n: Network, json: Json | undefined): string {
  const lines = [`## ${n.label}`, '', `Chain id ${n.chainId}. ${n.role}`, ''];
  if (!json) lines.push(`No \`deployments/${n.name}.json\` yet: every row below is ${PENDING}.`, '');
  else {
    const facts = [
      num(json.arbos) && `ArbOS ${num(json.arbos)}`,
      num(json.stylusVersion) && `Stylus v${num(json.stylusVersion)}`,
      str(json.deployer) && `deployer ${addressLink(n, json.deployer as string)}`,
    ].filter(Boolean);
    if (facts.length) lines.push(`Recorded in \`deployments/${n.name}.json\`: ${facts.join(', ')}.`, '');
  }
  const { rows } = contractRows(n, json);
  lines.push('| Contract | Address | Transactions | Notes |', '|---|---|---|---|', ...rows, '');
  const hero = heroRows(n, json);
  if (hero.length) {
    lines.push(`### ${n.label}: end-to-end transactions`, '');
    lines.push('| Step | Transaction or address |', '|---|---|', ...hero, '');
  }
  return lines.join('\n');
}

function renderProof(data: Map<string, Json | undefined>): string {
  const head = [
    '<!-- Rendered by scripts/render-proof.ts from deployments/*.json. Do not edit by hand. -->',
    '',
    '# Proof of deployment',
    '',
    'This page lists every Qanary contract and end-to-end transaction on a public chain, with explorer links. It is rendered from `deployments/<network>.json`; a row marked pending has no deployment record yet. To render it again, run `pnpm proof`.',
    '',
    'To check a Stylus verifier yourself, ask ArbWasm for its program version and call `verify` with a fixture from `vectors/`:',
    '',
    '```bash',
    'RPC=https://rpc.apechain.com/http',
    'V=0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1',
    'cast call -r $RPC 0x0000000000000000000000000000000000000071 \\',
    '  "programVersion(address)(uint16)" $V',
    'cast call -r $RPC $V "verify(bytes,bytes32,bytes)(bytes4)" \\',
    '  0x02$(cat vectors/mldsa44.pk) 0x$(cat vectors/mldsa44.msg) \\',
    '  0x$(cat vectors/mldsa44.sig)',
    '```',
    '',
    'A valid signature returns `0x024ad318`. Flip any byte of the signature or the message and the same call returns `0xffffffff`.',
    '',
  ].join('\n');
  const sections = NETWORKS.map((n) => networkSection(n, data.get(n.name)));
  const pause = [
    '## Why Arbitrum One runs the Solidity verifier',
    '',
    'On 2 October 2026 the Arbitrum Security Council paused new Stylus activations on Arbitrum One and Nova. Programs that were already active keep running; new programs cannot be activated until the setting is reverted.',
    '',
    PAUSE,
    '',
  ].join('\n');
  return `${[head, ...sections, pause].join('\n')}`;
}

function renderJudgesAddresses(data: Map<string, Json | undefined>): string {
  const rows = ['| Network | Contract | Address |', '|---|---|---|'];
  for (const n of NETWORKS) {
    const json = data.get(n.name);
    const all = allEntries(json);
    for (const x of n.contracts.filter((c) => c.key)) {
      const path = x.paths.find((p) => all.has(p));
      const e = path ? all.get(path) : undefined;
      rows.push(`| ${n.label} | ${x.label} | ${e ? addressLink(n, e.address) : PENDING} |`);
    }
  }
  return rows.join('\n');
}

function renderJudgesHero(data: Map<string, Json | undefined>): string {
  const rows = ['| Network | Step | Transaction or address |', '|---|---|---|'];
  for (const n of NETWORKS) {
    const json = data.get(n.name);
    for (const x of n.hero.filter((h) => h.key)) {
      const path = x.paths.find((p) => at(json, p) !== undefined);
      rows.push(`| ${n.label} | ${x.label} | ${path ? cell(n, at(json, path)) : PENDING} |`);
    }
  }
  return rows.join('\n');
}

function renderReadmeDeployments(data: Map<string, Json | undefined>): string {
  const rows = ['| Network | Signature verifier | ML-DSA-44 verifier | QuantumValidator |', '|---|---|---|---|'];
  for (const n of NETWORKS) {
    const json = data.get(n.name);
    const all = allEntries(json);
    const find = (labels: Expected[]) => {
      for (const x of labels) {
        const path = x.paths.find((p) => all.has(p));
        if (path) return addressLink(n, (all.get(path) as Entry).address);
      }
      return PENDING;
    };
    const backend = n.name === 'arbitrum-one' ? 'Solidity (fallback)' : 'Stylus';
    const expectsValidator = n.contracts.some((c) => c.label === 'QuantumValidator');
    const validator = find(CORE.slice(1, 2));
    const validatorCell = validator === PENDING && !expectsValidator ? 'not deployed' : validator;
    const verifier = find(n.name === 'arbitrum-one' ? FALLBACK : STYLUS.slice(0, 1));
    rows.push(`| ${n.label} | ${backend} | ${verifier} | ${validatorCell} |`);
  }
  return rows.join('\n');
}

function replaceBlock(text: string, name: string, body: string, file: string): string {
  const begin = `<!-- proof:begin ${name} -->`;
  const end = `<!-- proof:end ${name} -->`;
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`${file}: missing ${begin} … ${end}`);
  return `${text.slice(0, i + begin.length)}\n${body}\n${text.slice(j)}`;
}

// ------------------------------------------------------------------ main

const { dir, check } = args();
const data = new Map(NETWORKS.map((n) => [n.name, load(dir, n.name)] as const));

const outputs: [string, string][] = [['PROOF.md', renderProof(data)]];
const blocks: [string, string, string][] = [
  ['JUDGES.md', 'judges-addresses', renderJudgesAddresses(data)],
  ['JUDGES.md', 'judges-hero', renderJudgesHero(data)],
  ['README.md', 'readme-deployments', renderReadmeDeployments(data)],
];
const pending = new Map<string, string>();
for (const [file, name, body] of blocks) {
  const path = join(ROOT, file);
  const text = pending.get(file) ?? readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  pending.set(file, replaceBlock(text, name, body, file));
}
outputs.push(...pending.entries());

let stale = 0;
for (const [file, body] of outputs) {
  const path = join(ROOT, file);
  const previous = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
  if (previous === body) continue;
  stale++;
  if (check) console.error(`${file} is out of date: run pnpm proof`);
  else {
    writeFileSync(path, body);
    console.log(`wrote ${file}`);
  }
}
for (const n of NETWORKS) {
  const json = data.get(n.name);
  console.log(`${n.name}: ${json ? `${contractRows(n, json).found}/${n.contracts.length} expected contracts` : 'no deployment file'}`);
}
if (check && stale) process.exit(1);
