/**
 * Embeds the repository's `deployments/{arbitrum-one,arbitrum-sepolia}.json` into
 * `src/deployments.data.ts`, so the SDK ships the deployed addresses without file-system access.
 * A missing file is embedded as `null`. Runs before every build (`prebuild`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeployment, type QanaryChainId } from '../src/deployments.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, '../../../deployments');
const DEST = resolve(here, '../src/deployments.data.ts');

const FILES: [QanaryChainId, string][] = [
  [42161, 'arbitrum-one.json'],
  [421614, 'arbitrum-sepolia.json'],
];

const data: Record<string, unknown> = {};
for (const [chainId, file] of FILES) {
  const path = resolve(DIR, file);
  if (!existsSync(path)) {
    data[chainId] = null;
    console.log(`${file}: not present`);
    continue;
  }
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  parseDeployment(chainId, json); // reject malformed files before embedding them
  data[chainId] = json;
  console.log(`${file}: embedded`);
}

const body =
  '// Contents of deployments/*.json, embedded by scripts/gen-deployments.ts; do not edit.\n' +
  `export const deploymentFiles: Record<42161 | 421614, unknown> = ${JSON.stringify(data, null, 2)};\n`;
const previous = existsSync(DEST) ? readFileSync(DEST, 'utf8') : '';
if (previous !== body) writeFileSync(DEST, body);
