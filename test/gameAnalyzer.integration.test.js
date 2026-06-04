import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { analyzeGame } from '../src/side-panel/engine/gameAnalyzer.js';
import { pgnToPositions } from './support/pgnPositions.js';
import { createMockController } from './support/mockEngine.js';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

// Per-position-index eval script for all-classifications.pgn. Values are
// white-normalized centipawns; the mock re-encodes them per side to move.
// Each ply's class is produced by the eval pair (before, after) plus the
// best-move match and (for the sacrifice) the recapture continuation.
const WNC =    [20, 20, 20, 20, 20, 20, 40, 40, 55, 50, 60, 20, 10, -28, 48, 48, 222, -61, 320, 0, 33, 33, 44, 44, 60];
const BEST =   ['e2e4', '', '', '', '', '', 'b5a4', 'a2a3', '', '', 'f3e5', 'c6e5', 'a2a3', 'a2a3', 'e4e5', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'c1g5', 'a2a3', 'h5g5', 'a2a3', ''];
// detectSacrifice walks the PV of the position AFTER the move, so the recapture
// that settles 6.Nxe5 lives on index 11 (the position after Nxe5).
const PV = { 11: ['c6e5'] };
const SECOND = WNC.map((v) => v - 5);
SECOND[11] = 180; // wide gap after 6.Nxe5 -> 6...Nxe5 is the only good move ("great")

const EXPECTED = [
  /* 1 */ 'book', /* 2 */ 'book', /* 3 */ 'book', /* 4 */ 'book', /* 5 */ 'book',
  /* 6 */ 'book', /* 7 */ 'best', /* 8 */ 'excellent', /* 9 */ 'book', /* 10 */ 'book',
  /* 11 */ 'brilliant', /* 12 */ 'great', /* 13 */ 'good', /* 14 */ 'inaccuracy',
  /* 15 */ 'best', /* 16 */ 'mistake', /* 17 */ 'blunder', /* 18 */ 'blunder',
  /* 19 */ 'miss', /* 20 */ 'good', /* 21 */ 'best', /* 22 */ 'excellent',
  /* 23 */ 'best', /* 24 */ 'excellent',
];

async function runFixture() {
  const positions = pgnToPositions(fixture('all-classifications.pgn'));
  const controller = createMockController(positions, (index) => ({
    wnc: WNC[index],
    best: BEST[index],
    pv: PV[index] || [],
    second: SECOND[index],
  }));
  const classifications = await analyzeGame(positions, controller, { depth: 1 });
  return { positions, classifications };
}

test('analyzeGame produces the expected classification for every ply', async () => {
  const { classifications } = await runFixture();
  const got = classifications.slice(1).map((c) => c.classification);
  assert.deepEqual(got, EXPECTED);
});

test('the fixture exercises every move class', async () => {
  const { classifications } = await runFixture();
  const seen = new Set(classifications.slice(1).map((c) => c.classification));
  const required = [
    'book', 'best', 'excellent', 'good', 'inaccuracy',
    'mistake', 'blunder', 'brilliant', 'great', 'miss',
  ];
  for (const cls of required) {
    assert.ok(seen.has(cls), `expected at least one "${cls}" move in the fixture`);
  }
});

test('the brilliant move is flagged as a sacrifice and carries its glyph', async () => {
  const { classifications } = await runFixture();
  const brilliant = classifications.find((c) => c?.classification === 'brilliant');
  assert.ok(brilliant);
  assert.equal(brilliant.glyph, '!!');
  assert.equal(brilliant.isSacrifice, true);
  assert.ok(brilliant.sacAmount >= 2);
});

test('forced: a position with a single legal move is classified "forced"', async () => {
  const positions = pgnToPositions(fixture('forced.pgn'));
  const controller = createMockController(positions, () => ({ wnc: 500, best: 'a2a3', second: 490 }));
  const classifications = await analyzeGame(positions, controller, { depth: 1 });
  assert.equal(classifications[1].classification, 'forced');
});
