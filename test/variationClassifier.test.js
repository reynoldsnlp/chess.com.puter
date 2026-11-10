import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeGame } from '../src/side-panel/engine/gameAnalyzer.js';
import { createVariationClassifier } from '../src/side-panel/engine/variationClassifier.js';
import { pgnToPositions } from './support/pgnPositions.js';
import { createMockController } from './support/mockEngine.js';

// 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#
const LINE = pgnToPositions('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# *');
const WNC = [20, 30, 25, 10, 15, 60, 10000, 10000];
const BEST = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g7g6', 'h5f7', ''];

/** Mock engine that also counts searches and records MultiPV changes. */
function countingEngine(positions) {
  const base = createMockController(positions, (i) => ({ wnc: WNC[i], best: BEST[i], second: WNC[i] - 10 }));
  const engine = {
    searches: 0,
    multiPv: [],
    stops: 0,
    isReady: () => true,
    stop() { engine.stops++; },
    stopAndWait: base.stopAndWait,
    setMultiPV(n) { engine.multiPv.push(n); },
    analyzeAndWait(fen, depth) { engine.searches++; return base.analyzeAndWait(fen, depth); },
  };
  return engine;
}

function classifier(engine, extra = {}) {
  return createVariationClassifier({ getEngine: () => engine, getMultiPv: () => 3, depth: 1, ...extra });
}

test('classifies a move and caches both positions', async () => {
  const engine = countingEngine(LINE);
  const vc = classifier(engine);
  const cls = await vc.classify(LINE, 1, null);
  assert.equal(cls.classification, 'book');
  assert.equal(engine.searches, 2);
  assert.ok(vc.evalCache.has(LINE[0].fen) && vc.evalCache.has(LINE[1].fen));
});

test('consecutive moves reuse the shared position (one new search per move)', async () => {
  const engine = countingEngine(LINE);
  const vc = classifier(engine);
  await vc.classify(LINE, 1, null);
  await vc.classify(LINE, 2, null);
  assert.equal(engine.searches, 3);
});

test('matches full-game analysis exactly, including the Miss/Blunder context', async () => {
  const gameEngine = countingEngine(LINE);
  const full = await analyzeGame(LINE, gameEngine, { depth: 1 });

  const vc = classifier(countingEngine(LINE));
  let previous = null;
  for (let ply = 1; ply < LINE.length; ply++) {
    const cls = await vc.classify(LINE, ply, previous);
    assert.deepEqual(cls, full[ply], `ply ${ply}`);
    previous = cls;
  }
});

test('a branch from an analyzed game reuses its evaluations', async () => {
  const evalCache = new Map();
  await analyzeGame(LINE, countingEngine(LINE), { depth: 1, evalCache });
  const engine = countingEngine(LINE);
  const vc = classifier(engine, { evalCache });
  const cls = await vc.classify(LINE, 5, null);
  assert.ok(cls);
  assert.equal(engine.searches, 0);
  vc.release();
  assert.deepEqual(engine.multiPv, [], 'engine was never claimed, so nothing to restore');
});

test('the engine is claimed at MultiPV 2 and released at the live setting', async () => {
  const engine = countingEngine(LINE);
  const vc = classifier(engine);
  await vc.classify(LINE, 1, null);
  assert.deepEqual(engine.multiPv, [2]);
  vc.release();
  assert.deepEqual(engine.multiPv, [2, 3]);
  vc.release(); // idempotent
  assert.deepEqual(engine.multiPv, [2, 3]);
});

test('cancel discards in-flight work without caching it', async () => {
  const engine = countingEngine(LINE);
  const vc = classifier(engine);
  const pending = vc.classify(LINE, 1, null);
  const queued = vc.classify(LINE, 2, null);
  vc.cancel();
  assert.equal(await pending, null);
  assert.equal(await queued, null);
  assert.equal(vc.evalCache.size, 0);
});

test('work requested after a cancel runs normally', async () => {
  const engine = countingEngine(LINE);
  const vc = classifier(engine);
  vc.classify(LINE, 1, null);
  vc.cancel();
  const cls = await vc.classify(LINE, 1, null);
  assert.equal(cls.classification, 'book');
});

test('no engine (or not ready) resolves to null', async () => {
  const vc = createVariationClassifier({ getEngine: () => null, getMultiPv: () => 1 });
  assert.equal(await vc.classify(LINE, 1, null), null);
});

test('the cache evicts the oldest positions beyond its limit', async () => {
  const vc = classifier(countingEngine(LINE), { cacheLimit: 3 });
  for (let ply = 1; ply < 5; ply++) await vc.classify(LINE, ply, null);
  assert.equal(vc.evalCache.size, 3);
  assert.ok(!vc.evalCache.has(LINE[0].fen));
  assert.ok(vc.evalCache.has(LINE[4].fen));
});
