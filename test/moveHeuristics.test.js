import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeMoveTactics, materialLostByMove } from '../src/side-panel/engine/moveHeuristics.js';

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

// --- materialLostByMove ---

test('a quiet move that matches the best line loses nothing', () => {
  assert.equal(materialLostByMove(START, 'e2e4', ['e7e5'], ['e2e4', 'e7e5']), 0);
});

test('hanging the queen loses it relative to the best line', () => {
  // Qb1-b7?? is taken by the b8 rook; the best line keeps the queen.
  const fen = '1r4k1/8/8/8/8/8/8/1Q4K1 w - - 0 1';
  assert.equal(materialLostByMove(fen, 'b1b7', ['b8b7', 'g1g2'], ['g1g2']), 9);
});

test('not recapturing loses the piece the opponent just took', () => {
  // Black just played ...Rxd2 (taking a white rook); white should recapture.
  const prev = '6k1/3r4/8/8/8/8/3R4/3R2K1 b - - 0 1';
  const fen = '6k1/8/8/8/8/8/3r4/3R2K1 w - - 0 1';
  // Ignoring it loses the d2 rook already taken, and the d1 rook too.
  assert.equal(materialLostByMove(fen, 'g1f1', ['d2d1', 'f1e2'], ['d1d2'], prev), 5 + 5);
  // Ignoring it while the d1 rook stays safe still loses the d2 rook.
  assert.equal(materialLostByMove(fen, 'g1f1', ['g8f8', 'f1e1'], ['d1d2'], prev), 5);
});

test('failing to win offered material is not a loss (that is a Miss)', () => {
  // Black's rook on d4 is hanging to the d1 rook; white plays elsewhere.
  const prev = '3r2k1/8/8/8/8/8/8/3R2K1 b - - 0 1';
  const fen = '6k1/8/8/8/3r4/8/8/3R2K1 w - - 1 1';
  assert.equal(materialLostByMove(fen, 'g1g2', ['g8f8', 'g2g1'], ['d1d4', 'g8f8'], prev), 0);
});

test('a line ending on the opponent\'s capture is read before it (no half-finished exchanges)', () => {
  // The engine line stops right after ...Rxb7; the mover's reply is unknown,
  // so material is read at the last point the opponent was to move.
  const fen = '1r4k1/8/8/8/8/8/8/1Q4K1 w - - 0 1';
  assert.equal(materialLostByMove(fen, 'b1b7', ['b8b7'], ['g1g2']), 0);
});

test('an even trade loses nothing', () => {
  // Rxd8 Rxd8: a trade. The best line is cut right after the opponent's
  // recapture, which is fine; the played line's last odd ply is ignored.
  const fen = '3r2k1/3r4/8/8/8/8/3R4/3R2K1 w - - 0 1';
  assert.equal(materialLostByMove(fen, 'd2d7', ['d8d7', 'd1d7'], ['d2d7', 'd8d7', 'd1d7']), 0);
});

test('materialLostByMove tolerates bad input', () => {
  assert.equal(materialLostByMove('', 'e2e4'), 0);
  assert.equal(materialLostByMove(START, 'e2e5'), 0);
  assert.equal(materialLostByMove(START, 'e2e4', ['zz'], null), 0);
});
