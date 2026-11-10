import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeMoveTactics } from '../src/side-panel/engine/moveHeuristics.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Ruy Lopez after 5...Be7.
const RUY = 'r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6';
// ...and after 6.Nxe5.
const RUY_NXE5 = 'r1bqk2r/1pppbppp/p1n2n2/4N3/B3P3/8/PPPP1PPP/RNBQ1RK1 b kq - 0 6';

test('quiet developing move is neither a sacrifice nor a free capture', () => {
  const t = analyzeMoveTactics(START, 'e2e4');
  assert.equal(t.legal, true);
  assert.equal(t.isSacrifice, false);
  assert.equal(t.capturedFreeMaterial, false);
  assert.equal(t.wasInCheck, false);
});

test('leaving a knight en prise for a pawn is a sacrifice', () => {
  const t = analyzeMoveTactics(RUY, 'f3e5');
  assert.equal(t.isSacrifice, true);
  assert.deepEqual(t.sacrificedPieces, [{ square: 'e5', role: 'knight' }]);
});

test('recapturing an undefended piece is free material, not a sacrifice', () => {
  const t = analyzeMoveTactics(RUY_NXE5, 'c6e5');
  assert.equal(t.capturedFreeMaterial, true);
  assert.equal(t.isSacrifice, false);
});

test('taking an undefended rook is free material', () => {
  const t = analyzeMoveTactics('3r2k1/8/8/8/8/8/8/3R2K1 w - - 0 1', 'd1d8');
  assert.equal(t.capturedFreeMaterial, true);
  assert.equal(t.isSacrifice, false);
});

test('capturing a defended piece is not free material', () => {
  // Rxd7 when d7 is defended by the d8 rook (an even trade). With a second
  // white rook behind on d1, d7 would be genuinely winnable (x-ray battery).
  const t = analyzeMoveTactics('3r2k1/3r4/8/8/8/8/3R4/6K1 w - - 0 1', 'd2d7');
  assert.equal(t.capturedFreeMaterial, false);
});

test('a piece defended by a pawn is not en prise', () => {
  // Nb5-d4: attacked by the d8 rook, defended by the c3 pawn -> safe.
  const t = analyzeMoveTactics('3r3k/8/8/1N6/8/2P5/8/K7 w - - 0 1', 'b5d4');
  assert.equal(t.isSacrifice, false);
});

test('moving one attacked piece to safety while another stays attacked is not a sacrifice', () => {
  // e6 pawn forks knights on d5 and f5; Nd5-c3 saves one.
  const t = analyzeMoveTactics('7k/8/4p3/3N1N2/8/8/8/K7 w - - 0 1', 'd5c3');
  assert.equal(t.isSacrifice, false);
});

test('moves out of check are flagged', () => {
  const t = analyzeMoveTactics('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', 'e1e2');
  assert.equal(t.wasInCheck, true);
  assert.equal(t.capturedFreeMaterial, true);
});

test('promotion and checkmate are reported', () => {
  assert.equal(analyzeMoveTactics('7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7a8q').promotion, 'queen');
  // Back-rank mate.
  assert.equal(analyzeMoveTactics('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8').isCheckmate, true);
});

test('missing / illegal inputs are reported as not legal rather than throwing', () => {
  assert.equal(analyzeMoveTactics(START, '').legal, false);
  assert.equal(analyzeMoveTactics('', 'e2e4').legal, false);
  assert.equal(analyzeMoveTactics(START, 'e2e5').legal, false);
});
