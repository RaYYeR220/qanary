// Builds packages/sdk (tsup) when its dist is missing or older than its sources.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'sdk');
const out = join(sdk, 'dist', 'index.js');

function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

if (!existsSync(out) || statSync(out).mtimeMs < newest(join(sdk, 'src'))) {
  console.log('building @qanary/sdk');
  execSync('pnpm exec tsup', { cwd: sdk, stdio: 'inherit' });
}
