/**
 * Embeds the repository's `deployments/<network>.json` (one per known network, see
 * `src/networks.ts`) into `src/deployments.data.ts`, so the SDK ships the deployed addresses
 * without file-system access. A missing file is embedded as `null`. Runs before every build.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeployment } from '../src/deployments.js';
import { NETWORKS } from '../src/networks.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, '../../../deployments');
const DEST = resolve(here, '../src/deployments.data.ts');

const data: Record<string, unknown> = {};
for (const { name, chainId } of Object.values(NETWORKS)) {
  const path = resolve(DIR, `${name}.json`);
  if (!existsSync(path)) {
    data[name] = null;
    console.log(`${name}.json: not present`);
    continue;
  }
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  parseDeployment(chainId, json); // reject malformed files before embedding them
  data[name] = json;
  console.log(`${name}.json: embedded`);
}

const body =
  '// Contents of deployments/<network>.json, embedded by scripts/gen-deployments.ts; do not edit.\n' +
  `export const deploymentFiles: Record<string, unknown> = ${JSON.stringify(data, null, 2)};\n`;
const previous = existsSync(DEST) ? readFileSync(DEST, 'utf8') : '';
if (previous !== body) writeFileSync(DEST, body);
