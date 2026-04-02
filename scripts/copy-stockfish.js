// Copies Stockfish WASM files from @lichess-org/stockfish-web to public/stockfish/
// Also downloads the required NNUE neural network file.
// Run automatically via npm postinstall.

import { cpSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const destDir = resolve(__dirname, '..', 'public', 'stockfish');
const srcDir = resolve(__dirname, '..', 'node_modules', '@lichess-org', 'stockfish-web');

mkdirSync(destDir, { recursive: true });

// Copy the smallnet variant JS + WASM
const files = ['sf_18_smallnet.js', 'sf_18_smallnet.wasm'];
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

// Download the NNUE file required by sf_18_smallnet
const NNUE_NAME = 'nn-4ca89e4b3abf.nnue';
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

if (copied === files.length) {
  console.log('Stockfish files copied to public/stockfish/');
} else {
  console.warn('Warning: Not all Stockfish files were found.');
}
