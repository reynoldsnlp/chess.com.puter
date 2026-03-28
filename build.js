import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watching = process.argv.includes('--watch');

// Ensure dist directories exist
const dirs = [
  'dist/side-panel',
  'dist/service-worker',
  'dist/content-scripts',
  'dist/stockfish',
  'dist/assets/icons',
];
for (const dir of dirs) {
  mkdirSync(resolve(__dirname, dir), { recursive: true });
}

// Copy static files to dist
function copyStatic() {
  cpSync('src/manifest.json', 'dist/manifest.json');
  cpSync('src/side-panel/index.html', 'dist/side-panel/index.html');
  cpSync('src/side-panel/panel.css', 'dist/side-panel/panel.css');
  if (existsSync('public/stockfish')) {
    cpSync('public/stockfish', 'dist/stockfish', { recursive: true });
  }
  if (existsSync('assets/icons')) {
    cpSync('assets/icons', 'dist/assets/icons', { recursive: true });
  }
  // Copy chessground CSS assets
  const cgAssets = 'node_modules/@lichess-org/chessground/assets';
  if (existsSync(cgAssets)) {
    mkdirSync(resolve(__dirname, 'dist/side-panel/assets'), { recursive: true });
    cpSync(cgAssets, 'dist/side-panel/assets', { recursive: true });
  }
}

// esbuild configuration for each entry point
const commonOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: watching ? 'inline' : false,
  minify: !watching,
};

const entryPoints = [
  {
    ...commonOptions,
    entryPoints: ['src/side-panel/panel.js'],
    outfile: 'dist/side-panel/panel.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content-scripts/index.js'],
    outfile: 'dist/content-scripts/index.js',
    format: 'iife',
  },
  {
    ...commonOptions,
    entryPoints: ['src/service-worker/index.js'],
    outfile: 'dist/service-worker/index.js',
  },
];

async function build() {
  copyStatic();
  for (const options of entryPoints) {
    if (watching) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    } else {
      await esbuild.build(options);
    }
  }
  console.log(watching ? 'Watching for changes...' : 'Build complete.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
