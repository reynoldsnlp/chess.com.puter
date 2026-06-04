// A mock Stockfish controller for driving analyzeGame in tests without WASM.
//
// analyzeGame normalizes engine scores to white's perspective via
// normalizeScoreToWhite(score, isBlackToMove), which negates cp scores when
// black is to move. So a test that wants a position to evaluate to a given
// white-normalized centipawn value must hand the engine a score that, after
// that negation, yields it. This helper does that conversion for you: the
// script speaks in white-normalized cp (`wnc`/`second`) and the mock encodes
// it back into side-to-move scores.

/**
 * @param {Array<{fen: string}>} positions - position list from pgnToPositions
 * @param {(index: number, fen: string) => {wnc: number, best: string, pv?: string[], second?: number|null}} scriptFor
 *   Per-position eval script keyed by position index.
 */
export function createMockController(positions, scriptFor) {
  const fenToIndex = new Map(positions.map((p, i) => [p.fen, i]));

  return {
    stopAndWait: () => Promise.resolve(),
    setMultiPV: () => {},
    analyzeAndWait: (fen) => {
      const index = fenToIndex.get(fen);
      const s = scriptFor(index, fen);
      const isBlackToMove = fen.split(' ')[1] === 'b';
      const enc = (v) => ({ type: 'cp', value: isBlackToMove ? -v : v });
      return Promise.resolve({
        score: enc(s.wnc),
        bestMove: s.best || 'a2a3',
        pv: s.pv || [],
        secondScore: s.second == null ? null : enc(s.second),
        secondPv: [],
      });
    },
  };
}
