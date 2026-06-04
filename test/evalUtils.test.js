import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  whitePerspectiveScoreSign,
  scoreToWhiteNormalizedCp,
  normalizeScoreToWhite,
  getTerminalPositionEval,
  formatEvalScore,
} from '../src/side-panel/evalUtils.js';

test('whitePerspectiveScoreSign: cp and mate', () => {
  assert.equal(whitePerspectiveScoreSign({ type: 'cp', value: 120 }), 1);
  assert.equal(whitePerspectiveScoreSign({ type: 'cp', value: -120 }), -1);
  assert.equal(whitePerspectiveScoreSign({ type: 'cp', value: 0 }), 0);
  assert.equal(whitePerspectiveScoreSign({ type: 'mate', winner: 'white' }), 1);
  assert.equal(whitePerspectiveScoreSign({ type: 'mate', winner: 'black' }), -1);
  assert.equal(whitePerspectiveScoreSign(null), 0);
});

test('scoreToWhiteNormalizedCp: mate clamps to +/-10000', () => {
  assert.equal(scoreToWhiteNormalizedCp({ type: 'cp', value: 55 }), 55);
  assert.equal(scoreToWhiteNormalizedCp({ type: 'mate', winner: 'white' }), 10000);
  assert.equal(scoreToWhiteNormalizedCp({ type: 'mate', winner: 'black' }), -10000);
  assert.equal(scoreToWhiteNormalizedCp(null), 0);
});

test('normalizeScoreToWhite: negates cp when black is to move', () => {
  assert.deepEqual(
    normalizeScoreToWhite({ type: 'cp', value: 80 }, false),
    { type: 'cp', value: 80 },
  );
  assert.deepEqual(
    normalizeScoreToWhite({ type: 'cp', value: 80 }, true),
    { type: 'cp', value: -80 },
  );
});

test('normalizeScoreToWhite: derives mate winner from sign', () => {
  // Black to move, mate-in-3 for the side to move -> bad for white.
  const r = normalizeScoreToWhite({ type: 'mate', value: 3 }, true);
  assert.equal(r.type, 'mate');
  assert.equal(r.value, -3);
  assert.equal(r.winner, 'black');
});

test('getTerminalPositionEval: detects checkmate winner', () => {
  // Fool's mate position: white is checkmated, black wins.
  const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  const r = getTerminalPositionEval(fen);
  assert.ok(r);
  assert.equal(r.kind, 'checkmate');
  assert.equal(r.score.winner, 'black');
  assert.equal(r.whiteNormalizedCp, -10000);
});

test('getTerminalPositionEval: stalemate is a draw', () => {
  const fen = 'k7/8/1Q6/8/8/8/8/6K1 b - - 0 1'; // black king has no legal move, not in check
  const r = getTerminalPositionEval(fen);
  assert.ok(r);
  assert.equal(r.kind, 'draw');
  assert.equal(r.whiteNormalizedCp, 0);
});

test('getTerminalPositionEval: returns null for an ongoing position', () => {
  assert.equal(getTerminalPositionEval('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), null);
});

test('formatEvalScore: cp and mate formatting', () => {
  assert.equal(formatEvalScore({ type: 'cp', value: 150 }), '+1.5');
  assert.equal(formatEvalScore({ type: 'cp', value: -150 }), '-1.5');
  assert.equal(formatEvalScore({ type: 'mate', value: 4 }), 'M4');
  assert.equal(formatEvalScore({ type: 'mate', value: 0, winner: 'white' }), '1-0');
});

test('formatEvalScore: showPlus only controls the sign on an even position', () => {
  assert.equal(formatEvalScore({ type: 'cp', value: 0 }), '+0.0');
  assert.equal(formatEvalScore({ type: 'cp', value: 0 }, { showPlus: false }), '0.0');
});
