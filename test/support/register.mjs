// Registers the .tsv loader hook before the test runner imports any modules.
// Used via `node --import ./test/support/register.mjs --test`.

import { register } from 'node:module';

register('./tsv-loader.mjs', import.meta.url);
