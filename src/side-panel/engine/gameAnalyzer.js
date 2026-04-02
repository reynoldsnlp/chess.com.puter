// Full game analysis engine.
// Uses chess.com's Expected Points model for move classification.
// Expected Points = win probability on a 0.0-1.0 scale.
// "Expected Points Lost" = how much win probability the move cost.

import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';

/**
 * Convert centipawns to expected points (win probability, 0.0-1.0).
 * Uses Lichess's sigmoid formula (same curve chess.com uses internally).
 */
export function cpToExpectedPoints(cp) {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** Same as cpToExpectedPoints but on 0-100 scale for display */
export function cpToWinPercent(cp) {
  return cpToExpectedPoints(cp) * 100;
}

/**
 * Expected points from the mover's perspective.
 * @param {number} whiteNormalizedCp - eval from white's perspective
 * @param {boolean} isWhiteMove - true if white just moved
 */
function expectedPointsForMover(whiteNormalizedCp, isWhiteMove) {
  return isWhiteMove
    ? cpToExpectedPoints(whiteNormalizedCp)
    : cpToExpectedPoints(-whiteNormalizedCp);
}

/**
 * Classify a move using chess.com's Expected Points Lost thresholds.
 *
 * Expected Points Lost thresholds (0.0-1.0 scale):
 *   Best:       0.00        (matches engine's top choice)
 *   Excellent:  0.00-0.02
 *   Good:       0.02-0.05
 *   Inaccuracy: 0.05-0.10
 *   Mistake:    0.10-0.20
 *   Blunder:    0.20+
 *
 * @param {number} epLoss - expected points lost (0.0-1.0)
 * @param {boolean} isBestMove - player's move matches engine's top choice
 * @param {boolean} isForced - only one legal move in the position
 * @param {boolean} isBookMove - position is in the opening book (first few moves)
 */
function classifyMove(epLoss, isBestMove, isForced, isBookMove) {
  if (isBookMove) return { classification: 'book', glyph: '', epLoss };
  if (isForced) return { classification: 'forced', glyph: '', epLoss };
  if (isBestMove) return { classification: 'best', glyph: '', epLoss };
  if (epLoss <= 0.02) return { classification: 'excellent', glyph: '', epLoss };
  if (epLoss <= 0.05) return { classification: 'good', glyph: '', epLoss };
  if (epLoss <= 0.10) return { classification: 'inaccuracy', glyph: '?!', epLoss };
  if (epLoss <= 0.20) return { classification: 'mistake', glyph: '?', epLoss };
  return { classification: 'blunder', glyph: '??', epLoss };
}

/**
 * Run full game analysis.
 * @param {Array<{fen: string, san: string|null, uci: string|null}>} positions
 * @param {object} sfController
 * @param {object} options
 */
export async function analyzeGame(positions, sfController, options = {}) {
  const depth = options.depth || 16;
  const onProgress = options.onProgress || (() => {});
  const onComplete = options.onComplete || (() => {});
  const isCancelled = options.isCancelled || (() => false);

  const totalPositions = positions.length;
  const evals = [];

  // Ensure clean engine state
  await sfController.stopAndWait();
  sfController.setMultiPV(1);
  await sfController.stopAndWait();

  for (let i = 0; i < totalPositions; i++) {
    if (isCancelled()) return;

    const { fen } = positions[i];
    const isBlackToMove = fen.split(' ')[1] === 'b';

    onProgress(i, totalPositions);

    const result = await sfController.analyzeAndWait(fen, depth);
    if (isCancelled()) return;

    // Normalize eval to white's perspective
    let whiteNormalizedCp = result.score?.value || 0;
    if (result.score?.type === 'mate') {
      whiteNormalizedCp = result.score.value > 0 ? 10000 : -10000;
    }
    if (isBlackToMove) {
      whiteNormalizedCp = -whiteNormalizedCp;
    }

    // Count legal moves for "forced" detection
    const legalMoveCount = countLegalMoves(fen);

    evals.push({
      whiteNormalizedCp,
      bestMove: result.bestMove,
      pv: result.pv,
      legalMoveCount,
    });
  }

  onProgress(totalPositions, totalPositions);

  // Classify each move
  const classifications = [null]; // index 0 = starting position

  for (let ply = 1; ply < totalPositions; ply++) {
    const evalBefore = evals[ply - 1];
    const evalAfter = evals[ply];
    const isWhiteMove = ply % 2 === 1;

    // Expected points from the mover's perspective, before and after
    const epBefore = expectedPointsForMover(evalBefore.whiteNormalizedCp, isWhiteMove);
    const epAfter = expectedPointsForMover(evalAfter.whiteNormalizedCp, isWhiteMove);

    // Expected points lost (positive = bad for the mover)
    const epLoss = Math.max(0, epBefore - epAfter);

    // Check if the player's move matches the engine's best
    const engineBestUci = evalBefore.bestMove || '';
    const playerMoveUci = positions[ply].uci || '';
    const isBestMove = engineBestUci && playerMoveUci && engineBestUci === playerMoveUci;

    // Forced: only one legal move was available
    const isForced = evalBefore.legalMoveCount === 1;

    // Book: first few moves of the game (simplified heuristic)
    const isBookMove = ply <= 6 && epLoss <= 0.02;

    const classification = classifyMove(epLoss, isBestMove, isForced, isBookMove);

    classifications.push({
      ...classification,
      evalBefore: evalBefore.whiteNormalizedCp,
      evalAfter: evalAfter.whiteNormalizedCp,
      engineBestMove: engineBestUci,
      enginePv: evalBefore.pv,
    });
  }

  onComplete(classifications);
  return classifications;
}

/**
 * Count legal moves in a position using chessops.
 */
function countLegalMoves(fen) {
  try {
    const setup = parseFen(fen);
    if (setup.isErr) return 99;
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return 99;

    let count = 0;
    const dests = pos.value.allDests();
    for (const [, squares] of dests) {
      count += popcount(squares);
    }
    return count;
  } catch {
    return 99;
  }
}

/** Count bits in a SquareSet (bigint bitmask used by chessops) */
function popcount(squareSet) {
  // chessops SquareSet has a .size() method or we can iterate
  if (typeof squareSet.size === 'function') return squareSet.size();
  // Fallback: iterate
  let count = 0;
  for (const _ of squareSet) count++;
  return count;
}
