// Copies Stockfish WASM files from @lichess-org/stockfish-web to public/stockfish/
// Also downloads the required NNUE neural network file.
// Run automatically via npm postinstall.

import { cpSync, mkdirSync, existsSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const destDir = resolve(__dirname, '..', 'public', 'stockfish');
const srcDir = resolve(__dirname, '..', 'node_modules', '@lichess-org', 'stockfish-web');

mkdirSync(destDir, { recursive: true });

// Copy the smallnet variant JS + WASM
const files = ['sf_19_smallnet.js', 'sf_19_smallnet.wasm'];
let copied = 0;

for (const file of files) {
  const src = resolve(srcDir, file);
  if (existsSync(src)) {
    cpSync(src, resolve(destDir, file));
    console.log(`  Copied ${file}`);
    copied++;
  } else {
    console.warn(`  Warning: ${file} not found in ${srcDir}`);
  }
}

// Download the NNUE file required by sf_19_smallnet (see the package README;
// the panel loads whatever sf.getRecommendedNnue() names, so keep these in sync).
const NNUE_NAME = 'nn-61e7af4bb97d.nnue';
const NNUE_URL = `https://tests.stockfishchess.org/api/nn/${NNUE_NAME}`;
const nnueDest = resolve(destDir, NNUE_NAME);

if (existsSync(nnueDest)) {
  console.log(`  NNUE already exists: ${NNUE_NAME}`);
} else {
  console.log(`  Downloading NNUE: ${NNUE_NAME}...`);
  try {
    const resp = await fetch(NNUE_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(nnueDest, buf);
    console.log(`  Downloaded NNUE: ${NNUE_NAME} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error(`  Failed to download NNUE: ${err.message}`);
    console.error(`  You can manually download it from: ${NNUE_URL}`);
    console.error(`  Place it in: ${nnueDest}`);
  }
}

// Remove leftovers from previous engine versions so they aren't shipped.
const keep = new Set([...files, NNUE_NAME]);
for (const file of readdirSync(destDir)) {
  if (!keep.has(file)) {
    rmSync(resolve(destDir, file), { force: true });
    console.log(`  Removed stale ${file}`);
  }
}

if (copied === files.length) {
  console.log('Stockfish files copied to public/stockfish/');
} else {
  console.warn('Warning: Not all Stockfish files were found.');
}
