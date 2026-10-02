/**
 * Rewrites `src/abis/*.ts` from the forge artifacts in `contracts/evm/out`.
 *
 *   cd contracts/evm && forge build && cd ../../packages/sdk && npx tsx scripts/gen-abis.ts
 *
 * Contracts marked optional are skipped while their artifact does not exist yet; their
 * hand-written ABI file stays in place until the contract lands and this script is re-run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(here, '../../../contracts/evm/out');
const DEST = resolve(here, '../src/abis');

type Target = { contract: string; file: string; constName: string; description: string; optional?: boolean };

const TARGETS: Target[] = [
  { contract: 'KeyStore', file: 'keyStore', constName: 'keyStoreAbi', description: 'content-addressed KeyStore' },
  {
    contract: 'QuantumValidator',
    file: 'quantumValidator',
    constName: 'quantumValidatorAbi',
    description: 'QuantumValidator ERC-7579 validator module',
  },
  {
    contract: 'HotTierExecutor',
    file: 'hotTierExecutor',
    constName: 'hotTierExecutorAbi',
    description: 'HotTierExecutor ERC-7579 executor module',
    optional: true,
  },
  {
    contract: 'QuantumCanaryRegistry',
    file: 'canaryRegistry',
    constName: 'canaryRegistryAbi',
    description: 'QuantumCanaryRegistry',
    optional: true,
  },
  {
    contract: 'DrillRegistryFactory',
    file: 'drillRegistryFactory',
    constName: 'drillRegistryFactoryAbi',
    description: 'DrillRegistryFactory',
    optional: true,
  },
];

type AbiParam = { name?: string; type: string; indexed?: boolean; components?: AbiParam[]; internalType?: string };
type AbiItem = { type: string; inputs?: AbiParam[]; outputs?: AbiParam[]; [k: string]: unknown };

/** Drops solc's `internalType` annotations: viem does not need them and they bloat the bundle. */
function stripInternalTypes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripInternalTypes) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'internalType') out[k] = stripInternalTypes(v);
    return out as T;
  }
  return value;
}

let written = 0;
for (const t of TARGETS) {
  const artifact = resolve(ARTIFACTS, `${t.contract}.sol`, `${t.contract}.json`);
  if (!existsSync(artifact)) {
    if (t.optional) {
      console.log(`skip ${t.contract}: no artifact (keeping src/abis/${t.file}.ts)`);
      continue;
    }
    throw new Error(`missing artifact ${artifact}; run \`forge build\` in contracts/evm first`);
  }
  const abi = stripInternalTypes((JSON.parse(readFileSync(artifact, 'utf8')) as { abi: AbiItem[] }).abi).filter(
    (item) => item.type !== 'constructor',
  );
  const body =
    `/** ABI of the ${t.description}. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */\n` +
    `export const ${t.constName} = ${JSON.stringify(abi, null, 2)} as const;\n`;
  writeFileSync(resolve(DEST, `${t.file}.ts`), body);
  console.log(`wrote src/abis/${t.file}.ts (${abi.length} entries)`);
  written++;
}
console.log(`${written} ABI file(s) written`);
