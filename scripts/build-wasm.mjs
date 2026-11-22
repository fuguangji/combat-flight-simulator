// Builds the Rust physics core to WebAssembly and copies it to public/wasm/.
// Works the same locally and in CI. Requires: rustup target add wasm32-unknown-unknown
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = resolve(root, 'wasm/physics-engine');
const built = resolve(crateDir, 'target/wasm32-unknown-unknown/release/physics_engine.wasm');
const dest = resolve(root, 'public/wasm/physics_engine.wasm');

const r = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crateDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (r.status !== 0) {
  if (existsSync(dest) && !process.env.CI) {
    console.warn('[build-wasm] cargo failed or is missing; keeping existing', dest);
    process.exit(0);
  }
  console.error(
    '[build-wasm] Rust build failed. Install Rust (https://rustup.rs) and run:\n' +
      '  rustup target add wasm32-unknown-unknown',
  );
  process.exit(r.status ?? 1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log('[build-wasm] wrote', dest);
