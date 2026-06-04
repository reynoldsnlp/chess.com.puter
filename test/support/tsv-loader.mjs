// Minimal ESM loader hook so Node can import `.tsv` files the same way the
// esbuild bundle does (build.js configures `loader: { '.tsv': 'text' }`).
// Mirrors that behavior: a `.tsv` import resolves to its raw text as the
// default export. Zero dependencies — Node built-ins only.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsv')) {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(text)};`,
    };
  }
  return nextLoad(url, context);
}
