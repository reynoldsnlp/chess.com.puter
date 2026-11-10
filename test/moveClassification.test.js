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
    moverCpAfter: 0,
    moverCpSecond: 0,
    isBestMove: false,
    isForced: false,
    isBookMove: false,
    tactics: {},
    ...overrides,
  };
}

const classOf = (overrides) => classifyMove(ctx(overrides)).classification;
const SAC = { isSacrifice: true };

test('book and forced take precedence over everything', () => {
  assert.equal(classOf({ isBookMove: true, isBestMove: true, tactics: SAC }), 'book');
  assert.equal(classOf({ isForced: true, isBestMove: true, tactics: SAC }), 'forced');
});

test('checkmate is simply best', () => {
  assert.equal(classOf({ isBestMove: true, tactics: { isCheckmate: true, isSacrifice: true } }), 'best');
});

test('brilliant: top move that is a genuine sacrifice in a competitive position', () => {
  assert.equal(classOf({ isBestMove: true, moverCpAfter: 50, moverCpSecond: 20, tactics: SAC }), 'brilliant');
});

test('brilliant requires the engine top move, not just a near-best one', () => {
  assert.equal(classOf({ epLoss: 0.01, moverCpAfter: 50, tactics: SAC }), 'excellent');
});

test('no brilliant/great when still completely winning without the move', () => {
  const winning = { isBestMove: true, epBefore: 0.95, epSecond: 0.8, moverCpAfter: 900, moverCpSecond: 700 };
  assert.equal(classOf({ ...winning, tactics: SAC }), 'best');
  assert.equal(classOf(winning), 'best');
});

test('without a 2nd line, "winning anyway" falls back to the eval after the move', () => {
  assert.equal(classOf({ isBestMove: true, epSecond: null, moverCpSecond: null, moverCpAfter: 800, tactics: SAC }), 'best');
  assert.equal(classOf({ isBestMove: true, epSecond: null, moverCpSecond: null, moverCpAfter: 100, tactics: SAC }), 'brilliant');
});

test('no brilliant/great in a losing position', () => {
  assert.equal(classOf({ isBestMove: true, moverCpAfter: -50, tactics: SAC }), 'best');
  assert.equal(classOf({ isBestMove: true, moverCpAfter: -50, epBefore: 0.45, epSecond: 0.2 }), 'best');
});

test('no brilliant/great when escaping check', () => {
  assert.equal(classOf({ isBestMove: true, tactics: { ...SAC, wasInCheck: true } }), 'best');
  assert.equal(classOf({ isBestMove: true, epBefore: 0.6, epSecond: 0.4, tactics: { wasInCheck: true } }), 'best');
});

test('promotions are never brilliant; queen promotions are never great', () => {
  assert.equal(classOf({ isBestMove: true, tactics: { ...SAC, promotion: 'knight' } }), 'best');
  assert.equal(classOf({ isBestMove: true, epBefore: 0.6, epSecond: 0.4, tactics: { promotion: 'queen' } }), 'best');
  assert.equal(classOf({ isBestMove: true, epBefore: 0.6, epSecond: 0.4, tactics: { promotion: 'knight' } }), 'great');
});

test('great: the only good move (clear gap to the 2nd-best alternative)', () => {
  assert.equal(classOf({ isBestMove: true, epBefore: 0.7, epAfter: 0.7, epSecond: 0.55, moverCpAfter: 230 }), 'great');
});

test('great is not awarded for capturing free material (e.g. a recapture)', () => {
  assert.equal(
    classOf({ isBestMove: true, epBefore: 0.7, epSecond: 0.4, moverCpAfter: 230, tactics: { capturedFreeMaterial: true } }),
    'best',
  );
});

test('great is not awarded when the mover already has a forced mate', () => {
  assert.equal(classOf({ isBestMove: true, epBefore: 1, epSecond: 0.5, moverCpAfter: 10000, moverCpSecond: 0 }), 'best');
});

test('great needs a known 2nd-best line', () => {
  assert.equal(classOf({ isBestMove: true, epBefore: 0.7, epSecond: null, moverCpSecond: null, moverCpAfter: 230 }), 'best');
});

test('brilliant outranks great when a move is both a sacrifice and the only good move', () => {
  assert.equal(classOf({ isBestMove: true, epBefore: 0.7, epSecond: 0.55, moverCpAfter: 230, tactics: SAC }), 'brilliant');
});

test('best / excellent / good thresholds', () => {
  assert.equal(classOf({ isBestMove: true }), 'best');
  assert.equal(classOf({ epLoss: 0.015, epBefore: 0.5, epAfter: 0.485 }), 'excellent');
  assert.equal(classOf({ epLoss: 0.04, epBefore: 0.5, epAfter: 0.46 }), 'good');
});

test('inaccuracy / mistake / blunder thresholds', () => {
  assert.equal(classOf({ epLoss: 0.07, epBefore: 0.5, epAfter: 0.43 }), 'inaccuracy');
  assert.equal(classOf({ epLoss: 0.15, epBefore: 0.5, epAfter: 0.35 }), 'mistake');
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.6, epAfter: 0.30, materialLost: 3 }), 'blunder');
});

test('blunder requires losing material or allowing mate', () => {
  const bigDrop = { epLoss: 0.30, epBefore: 0.6, epAfter: 0.30 };
  assert.equal(classOf(bigDrop), 'mistake');
  assert.equal(classOf({ ...bigDrop, materialLost: 1 }), 'blunder');
  assert.equal(classOf({ ...bigDrop, allowsMate: true }), 'blunder');
  // Material loss alone doesn't make a small drop a blunder.
  assert.equal(classOf({ epLoss: 0.15, epBefore: 0.5, epAfter: 0.35, materialLost: 3 }), 'mistake');
});

test("miss: failing to punish the opponent's mistake", () => {
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50, opponentEpLoss: 0.25 }), 'miss');
  assert.equal(classOf({ epLoss: 0.12, epBefore: 0.78, epAfter: 0.53, opponentEpLoss: 0.10 }), 'miss');
});

test('throwing away a win without a prior opponent error is not a miss', () => {
  // Winning all along (no gift from the opponent): a plain mistake/blunder.
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50, opponentEpLoss: 0.01 }), 'mistake');
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50, opponentEpLoss: 0.01, materialLost: 3 }), 'blunder');
  assert.equal(classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50 }), 'mistake'); // first move: no previous ply
});

test('a reply that loses material after an opponent error is a blunder, not a miss', () => {
  assert.equal(
    classOf({ epLoss: 0.30, epBefore: 0.80, epAfter: 0.50, opponentEpLoss: 0.25, materialLost: 5 }),
    'blunder',
  );
});

test('no miss when the mover is still winning, or never had a win', () => {
  assert.equal(classOf({ epLoss: 0.15, epBefore: 0.95, epAfter: 0.80, opponentEpLoss: 0.3 }), 'mistake');
  assert.equal(classOf({ epLoss: 0.15, epBefore: 0.60, epAfter: 0.45, opponentEpLoss: 0.3 }), 'mistake');
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
