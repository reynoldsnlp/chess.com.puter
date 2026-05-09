import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watching = process.argv.includes('--watch');
const sourceManifestNameSuffix = ' [source only - run npm run build]';
const sourceManifestVersionSuffix = '-source';

// Ensure dist directories exist
const dirs = [
  'dist/side-panel',
  'dist/service-worker',
  'dist/content-scripts',
  'dist/stockfish',
  'dist/icons',
  'dist/assets/icons',
];
for (const dir of dirs) {
  mkdirSync(resolve(__dirname, dir), { recursive: true });
}

function buildManifest() {
  const manifestPath = resolve(__dirname, 'src/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 0) {
    throw new Error('src/manifest.json must stay unloadable. Use manifest_version: 0 and load dist/ instead.');
  }

  if (!manifest.name.endsWith(sourceManifestNameSuffix)) {
    throw new Error(`src/manifest.json name must end with "${sourceManifestNameSuffix}".`);
  }

  if (!manifest.version.endsWith(sourceManifestVersionSuffix)) {
    throw new Error(`src/manifest.json version must end with "${sourceManifestVersionSuffix}".`);
  }

  const distManifest = {
    ...manifest,
    manifest_version: 3,
    name: manifest.name.slice(0, -sourceManifestNameSuffix.length),
    version: manifest.version.slice(0, -sourceManifestVersionSuffix.length),
  };

  if (!/^\d+(\.\d+){0,3}$/.test(distManifest.version)) {
    throw new Error(`Built manifest version "${distManifest.version}" is not a valid Chrome extension version.`);
  }

  writeFileSync(
    resolve(__dirname, 'dist/manifest.json'),
    `${JSON.stringify(distManifest, null, 2)}\n`,
  );
}

// Copy static files to dist
function copyStatic() {
  buildManifest();
  cpSync('src/side-panel/index.html', 'dist/side-panel/index.html');
  cpSync('src/side-panel/panel.css', 'dist/side-panel/panel.css');
  if (existsSync('public/stockfish')) {
    cpSync('public/stockfish', 'dist/stockfish', { recursive: true });
  }
  if (existsSync('src/icons')) {
    cpSync('src/icons', 'dist/icons', { recursive: true });
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
  loader: { '.tsv': 'text' },
};

const entryPoints = [
  {
    ...commonOptions,
    entryPoints: ['src/side-panel/panel.js'],
    outfile: 'dist/side-panel/panel.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content-scripts/main.js'],
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
