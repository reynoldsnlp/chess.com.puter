// Classifies moves played outside the analyzed game (Sandbox moves and
// variations branched from the main line) with the same rules and depth as
// full-game analysis (see gameAnalyzer.js and MOVE_CLASSIFICATION.md).
//
// The engine is shared with live analysis, so requests are serialized and the
// caller hands the engine back with release() before resuming live analysis.
// Evaluations are cached by FEN: consecutive moves share a position, and
// branching from an analyzed game reuses the full-game analysis results.

import { classifyPly, evaluatePosition } from './gameAnalyzer.js';

const DEFAULT_CACHE_LIMIT = 2000;

/**
 * @param {object} options
 * @param {() => object|null} options.getEngine - current Stockfish controller
 * @param {() => number} options.getMultiPv - MultiPV to restore for live analysis
 * @param {Map<string, object>} [options.evalCache] - shared FEN -> evaluation cache
 * @param {number} [options.depth] - search depth (matches full-game analysis)
 * @param {number} [options.cacheLimit] - max cached positions (oldest evicted first)
 */
export function createVariationClassifier({
  getEngine,
  getMultiPv,
  evalCache = new Map(),
  depth = 16,
  cacheLimit = DEFAULT_CACHE_LIMIT,
}) {
  let chain = Promise.resolve();
  let generation = 0;
  let engineClaimed = false; // MultiPV is 2 and live analysis must wait

  function remember(fen, evaluation) {
    evalCache.delete(fen);
    evalCache.set(fen, evaluation);
    while (evalCache.size > cacheLimit) evalCache.delete(evalCache.keys().next().value);
  }

  async function evaluate(engine, fen, gen) {
    const cached = evalCache.get(fen);
    if (cached) return cached;
    const evaluation = await evaluatePosition(fen, engine, depth);
    // A cancelled search may have been cut short; don't trust or cache it.
    if (gen !== generation) return null;
    remember(fen, evaluation);
    return evaluation;
  }

  async function claimEngine(engine) {
    if (engineClaimed) return;
    engineClaimed = true;
    await engine.stopAndWait();
    engine.setMultiPV(2);
    await engine.stopAndWait();
  }

  return {
    evalCache,

    /**
     * Classify the move reaching positions[ply]. Resolves to the
     * classification, or null if cancelled or the engine isn't available.
     * @param {Array<{fen: string, uci: string|null}>} positions - line from its start
     * @param {number} ply
     * @param {object|null} previousCls - classification of the move before (for Miss)
     */
    classify(positions, ply, previousCls = null) {
      const gen = generation;
      const run = chain.then(async () => {
        if (gen !== generation) return null;
        const engine = getEngine();
        if (!engine?.isReady()) return null;

        const fenBefore = positions[ply - 1].fen;
        const fenAfter = positions[ply].fen;
        if (!evalCache.has(fenBefore) || !evalCache.has(fenAfter)) {
          await claimEngine(engine);
          if (gen !== generation) return null;
        }

        const before = await evaluate(engine, fenBefore, gen);
        if (!before) return null;
        const after = await evaluate(engine, fenAfter, gen);
        if (!after) return null;
        return classifyPly(positions, ply, before, after, previousCls);
      });
      chain = run.catch(() => null);
      return run;
    },

    /** Restore live-analysis engine settings once classification is done. */
    release() {
      if (!engineClaimed) return;
      engineClaimed = false;
      getEngine()?.setMultiPV(getMultiPv());
    },

    /** Abandon pending/in-flight work and hand the engine back. */
    cancel() {
      generation++;
      if (engineClaimed) getEngine()?.stop();
      this.release();
    },
  };
}
