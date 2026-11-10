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
// Each ply's class is produced by the eval pair (before, after), the best-move
// match, the 2nd-best line, and static board analysis of the move.
const WNC =    [20, 20, 20, 20, 20, 20, 40, 40, 55, 50, 60, 20, 10, -28, 48, 48, 222, -61, 320, 0, 33, 33, 44, 44, 60];
// 11.Bg5 and 12.Qxg5 are not scripted as top moves: on the real board both
// hang material to the Qd8/Be7 battery, so as top moves they'd be "brilliant".
const BEST =   ['e2e4', '', '', '', '', '', 'b5a4', 'a2a3', '', '', 'f3e5', 'c6e5', 'a2a3', 'a2a3', 'e4e5', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', 'a2a3', ''];
// Blunders must lose material: give the engine lines after 9.Qg4 and 9...O-O
// a material-winning continuation for the opponent (net one pawn each).
const PV = {
  17: ['d5f4', 'a2a3', 'f4g2', 'h2h3'], // ...Nf4, ...Nxg2
  18: ['a4d7', 'a6a5'],                 // Bxd7
};
const SECOND = WNC.map((v) => v - 5);
// Wide gap after 6.Nxe5: 6...Nxe5 is the only good move, but it recaptures a
// hanging knight (free material), so it must stay "best", not "great".
SECOND[11] = 180;
// Wide gap after 7...Ng6: 8.e5 (a quiet pawn push) is the only good move -> "great".
SECOND[14] = -150;

const EXPECTED = [
  /* 1 */ 'book', /* 2 */ 'book', /* 3 */ 'book', /* 4 */ 'book', /* 5 */ 'book',
  /* 6 */ 'book', /* 7 */ 'best', /* 8 */ 'excellent', /* 9 */ 'book', /* 10 */ 'book',
  /* 11 */ 'brilliant', /* 12 */ 'best', /* 13 */ 'good', /* 14 */ 'inaccuracy',
  /* 15 */ 'great', /* 16 */ 'mistake', /* 17 */ 'blunder', /* 18 */ 'blunder',
  /* 19 */ 'miss', /* 20 */ 'good', /* 21 */ 'excellent', /* 22 */ 'excellent',
  /* 23 */ 'excellent', /* 24 */ 'excellent',
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
  assert.deepEqual(brilliant.sacrificedPieces, [{ square: 'e5', role: 'knight' }]);
});

test('forced: a position with a single legal move is classified "forced"', async () => {
  const positions = pgnToPositions(fixture('forced.pgn'));
  const controller = createMockController(positions, () => ({ wnc: 500, best: 'a2a3', second: 490 }));
  const classifications = await analyzeGame(positions, controller, { depth: 1 });
  assert.equal(classifications[1].classification, 'forced');
});
