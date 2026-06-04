import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMove,
  cpToExpectedPoints,
  cpToWinPercent,
  moveAccuracy,
  gameAccuracy,
} from '../src/side-panel/engine/gameAnalyzer.js';

// Reasonable defaults; each test overrides the fields that matter for its class.
function ctx(overrides) {
  return {
    epLoss: 0,
    epBefore: 0.5,
    epAfter: 0.5,
    epSecond: 0.5,
    sacAmount: 0,
    isBestMove: false,
    isForced: false,
    isBookMove: false,
    ...overrides,
  };
}

const classOf = (overrides) => classifyMove(ctx(overrides)).classification;

test('book and forced take precedence over everything', () => {
  assert.equal(classOf({ isBookMove: true, isBestMove: true, sacAmount: 5 }), 'book');
  assert.equal(classOf({ isForced: true, isBestMove: true, sacAmount: 5 }), 'forced');
});

test('brilliant: sound sacrifice that stays at least equal and was not already winning', () => {
  assert.equal(
    classOf({ epLoss: 0.03, epBefore: 0.6, epAfter: 0.55, epSecond: 0.6, sacAmount: 3, isBestMove: true }),
    'brilliant',
  );
});

test('a sacrifice is NOT brilliant when already completely winning', () => {
  assert.notEqual(
    classOf({ epLoss: 0.0, epBefore: 0.99, epAfter: 0.98, epSecond: 0.99, sacAmount: 3, isBestMove: true }),
    'brilliant',
  );
});

test('a sacrifice is NOT brilliant when losing afterward', () => {
  const c = classOf({ epLoss: 0.3, epBefore: 0.6, epAfter: 0.3, epSecond: 0.6, sacAmount: 3, isBestMove: false });
  assert.notEqual(c, 'brilliant');
});

test('a sacrifice that is too small (a pawn) is not brilliant', () => {
  assert.equal(
    classOf({ epLoss: 0.0, epBefore: 0.6, epAfter: 0.58, epSecond: 0.6, sacAmount: 1, isBestMove: true }),
    'best',
  );
});

test('great: the only good move (clear gap to the 2nd-best alternative)', () => {
  assert.equal(
    classOf({ epLoss: 0.0, epBefore: 0.7, epAfter: 0.7, epSecond: 0.55, sacAmount: 0, isBestMove: true }),
    'great',
  );
});

test('brilliant outranks great when a move is both a sacrifice and the only good move', () => {
  assert.equal(
    classOf({ epLoss: 0.0, epBefore: 0.7, epAfter: 0.6, epSecond: 0.55, sacAmount: 3, isBestMove: true }),
    'brilliant',
  );
});

test('best / excellent / good thresholds', () => {
  assert.equal(classOf({ isBestMove: true }), 'best');
  assert.equal(classOf({ epLoss: 0.015, epBefore: 0.5, epAfter: 0.485 }), 'excellent');
  assert.equal(classOf({ epLoss: 0.04, epBefore: 0.5, epAfter: 0.46 }), 'good');
});

test('inaccuracy / mistake / blunder thresholds (not winning, so not a miss)', () => {
  assert.equal(classOf({ epLoss: 0.07, epBefore: 0.5, epAfter: 0.43 }), 'inaccuracy');
  assert.equal(classOf({ epLoss: 0.15, epBefore: 0.5, epAfter: 0.35 }), 'mistake');
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.6, epAfter: 0.30 }), 'blunder');
});

test('miss: a winning position (>=0.75) dropped to roughly equal or worse', () => {
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50 }), 'miss');
});

test('the same eval drop is a blunder (not a miss) when no win existed', () => {
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.60, epAfter: 0.30 }), 'blunder');
});

// --- Expected Points math ---

test('cpToExpectedPoints is 0.5 at equality and monotonic', () => {
  assert.ok(Math.abs(cpToExpectedPoints(0) - 0.5) < 1e-9);
  assert.ok(cpToExpectedPoints(100) > cpToExpectedPoints(0));
  assert.ok(cpToExpectedPoints(-100) < cpToExpectedPoints(0));
  assert.ok(cpToExpectedPoints(5000) > 0.99);
});

test('cpToWinPercent is cpToExpectedPoints on a 0-100 scale', () => {
  assert.ok(Math.abs(cpToWinPercent(0) - 50) < 1e-9);
  assert.ok(Math.abs(cpToWinPercent(100) - cpToExpectedPoints(100) * 100) < 1e-9);
});

test('moveAccuracy: ~100 for no drop, lower as the drop grows, clamped to [0,100]', () => {
  assert.ok(moveAccuracy(50, 50) > 99.9);
  assert.ok(moveAccuracy(60, 40) < moveAccuracy(60, 55));
  assert.equal(moveAccuracy(50, 60), moveAccuracy(50, 50)); // improvement clamps drop to 0
  const acc = moveAccuracy(90, 10);
  assert.ok(acc >= 0 && acc <= 100);
});

test('gameAccuracy: perfect play is 100, a blunder pulls the harmonic mean down', () => {
  const isMine = () => true;
  const perfect = [null, { evalBefore: 0, evalAfter: 0 }, { evalBefore: 0, evalAfter: 0 }];
  assert.ok(Math.abs(gameAccuracy(perfect, isMine) - 100) < 0.01);

  // ply 1 (white) drops from +0 to -300 cp: a big blunder.
  const withBlunder = [null, { evalBefore: 0, evalAfter: -300 }, { evalBefore: 0, evalAfter: 0 }];
  const acc = gameAccuracy(withBlunder, isMine);
  assert.ok(acc < 100 && acc > 0);
});
