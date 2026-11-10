import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSameMove } from '../src/shared/chessUtils.js';

const CASTLE_BOTH = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';

test('castling written as king destination or king-takes-rook is the same move', () => {
  assert.equal(isSameMove(CASTLE_BOTH, 'e1g1', 'e1h1'), true);
  assert.equal(isSameMove(CASTLE_BOTH, 'e1h1', 'e1g1'), true);
  assert.equal(isSameMove(CASTLE_BOTH, 'e1c1', 'e1a1'), true);
  assert.equal(isSameMove(CASTLE_BOTH.replace(' w ', ' b '), 'e8g8', 'e8h8'), true);
});

test('kingside and queenside castling are different moves', () => {
  assert.equal(isSameMove(CASTLE_BOTH, 'e1g1', 'e1a1'), false);
});

test('a king step next to the rook is not mistaken for castling without rights', () => {
  // No castling rights: e1f1 is a plain king move and differs from e1g1 (illegal anyway).
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1';
  assert.equal(isSameMove(fen, 'e1g1', 'e1h1'), false);
});

test('ordinary moves and promotions compare exactly', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(isSameMove(start, 'e2e4', 'e2e4'), true);
  assert.equal(isSameMove(start, 'e2e4', 'd2d4'), false);
  const promo = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
  assert.equal(isSameMove(promo, 'a7a8q', 'a7a8n'), false);
  assert.equal(isSameMove(promo, 'a7a8q', 'a7a8q'), true);
});

test('missing inputs are never the same move', () => {
  assert.equal(isSameMove(CASTLE_BOTH, '', 'e1g1'), false);
  assert.equal(isSameMove(CASTLE_BOTH, 'e1g1', null), false);
  assert.equal(isSameMove('', 'e1g1', 'e1h1'), false);
});
