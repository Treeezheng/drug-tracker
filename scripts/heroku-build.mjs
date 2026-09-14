import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, DRUG_EDITION: 'cloud', DRUG_BASE_PATH: '/drug/' };
const outDir = process.env.DRUG_BUILD_OUT_DIR;
if (outDir && !isAbsolute(outDir)) throw new Error('Use an absolute test build output directory.');
for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build', ...(outDir ? ['--outDir', outDir] : [])]]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
