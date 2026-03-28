// Copies Stockfish WASM files from @lichess-org/stockfish-web to public/stockfish/
// Run automatically via npm postinstall.

import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const destDir = resolve(__dirname, '..', 'public', 'stockfish');
const srcDir = resolve(__dirname, '..', 'node_modules', '@lichess-org', 'stockfish-web');

mkdirSync(destDir, { recursive: true });

// Copy the smallnet variant (single NNUE, ~600KB total)
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

if (copied === files.length) {
  console.log('Stockfish files copied to public/stockfish/');
} else {
  console.warn('Warning: Not all Stockfish files were found.');
}
