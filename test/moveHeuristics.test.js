import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectSacrifice } from '../src/side-panel/engine/moveHeuristics.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('quiet developing move sacrifices nothing', () => {
  assert.equal(detectSacrifice(START, 'e2e4', ['e7e5']), 0);
});

test('hanging the queen for a pawn counts the full material given up', () => {
  // White queen on b1 takes h7 (a pawn); black king recaptures.
  const fen = '6k1/7p/8/8/8/8/8/1Q4K1 w - - 0 1';
  assert.equal(detectSacrifice(fen, 'b1h7', ['g8h7']), 8); // queen (9) for pawn (1)
});

test('a true minor-piece sacrifice in the fixture line scores ~3', () => {
  // Position after 5...Be7 (Ruy Lopez). 6.Nxe5 gives a knight for a pawn
  // after 6...Nxe5; net ~2 points given up.
  const fen = 'r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6';
  assert.equal(detectSacrifice(fen, 'f3e5', ['c6e5']), 2);
});

test('capturing a piece for free is a gain, not a sacrifice', () => {
  // White rook captures an undefended rook; no continuation. Clamped to 0.
  const fen = '3r2k1/8/8/8/8/8/8/3R2K1 w - - 0 1';
  assert.equal(detectSacrifice(fen, 'd1d8', []), 0);
});

test('an even trade nets zero', () => {
  // Rxd8 Rxd8: rook for rook.
  const fen = '3r2k1/3r4/8/8/8/8/3R4/3R2K1 w - - 0 1';
  assert.equal(detectSacrifice(fen, 'd2d8', ['d7d8']), 0);
});

test('missing / illegal inputs return 0 rather than throwing', () => {
  assert.equal(detectSacrifice(START, '', ['e7e5']), 0);
  assert.equal(detectSacrifice('', 'e2e4', []), 0);
  assert.equal(detectSacrifice(START, 'e2e5', []), 0); // illegal move
});
