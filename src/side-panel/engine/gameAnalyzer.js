// Full game analysis engine.
// Uses chess.com's Expected Points model for move classification.
// Expected Points = win probability on a 0.0-1.0 scale.
// "Expected Points Lost" = how much win probability the move cost.

import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { getPrimaryOpening } from '../../shared/openings.js';
import {
  getTerminalPositionEval,
  normalizeScoreToWhite,
  scoreToWhiteNormalizedCp,
} from '../evalUtils.js';
import { detectSacrifice } from './moveHeuristics.js';

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
 * Per-move accuracy using Lichess formula.
 * winPctBefore/After on 0-100 scale.
 * Returns 0-100.
 */
export function moveAccuracy(winPctBefore, winPctAfter) {
  const drop = winPctBefore - winPctAfter; // positive = lost winning chances
  const acc = 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

/**
 * Compute game accuracy for a set of classifications (one player's moves).
 * Uses harmonic mean of per-move accuracies (weights bad moves more heavily).
 */
export function gameAccuracy(classifications, isMyMoveFn) {
  let sumReciprocal = 0;
  let count = 0;
  for (let ply = 1; ply < classifications.length; ply++) {
    if (!isMyMoveFn(ply)) continue;
    const cls = classifications[ply];
    if (!cls) continue;

    const isWhiteMove = ply % 2 === 1;
    const wpBefore = isWhiteMove ? cpToWinPercent(cls.evalBefore) : cpToWinPercent(-cls.evalBefore);
    const wpAfter = isWhiteMove ? cpToWinPercent(cls.evalAfter) : cpToWinPercent(-cls.evalAfter);
    const acc = moveAccuracy(wpBefore, wpAfter);
    if (acc > 0) {
      sumReciprocal += 1 / acc;
      count++;
    }
  }
  if (count === 0) return 0;
  return count / sumReciprocal; // harmonic mean
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

// Thresholds for the special (Brilliant/Great/Miss) classifications.
// All EP values are from the mover's perspective on the 0.0-1.0 scale.
const SAC_MIN_PAWNS = 2;        // a real sacrifice is at least ~a minor piece
const BRILLIANT_NOT_WINNING = 0.97; // can't already be completely winning
const BRILLIANT_NOT_LOSING = 0.5;   // can't be losing after the sacrifice
const NEAR_BEST_EP_LOSS = 0.02;     // "best or nearly best"
const GREAT_ONLY_MOVE_GAP = 0.10;   // 2nd-best move must lose >= this much EP
const MISS_HAD_WIN = 0.75;          // a clear winning chance existed
const MISS_LOST_WIN = 0.55;         // ...and it's no longer winning after

/**
 * Classify a move using chess.com's Expected Points model, including the
 * special Brilliant/Great/Miss classifications.
 *
 * Expected Points Lost thresholds (0.0-1.0 scale):
 *   Best:       0.00        (matches engine's top choice)
 *   Excellent:  0.00-0.02
 *   Good:       0.02-0.05
 *   Inaccuracy: 0.05-0.10
 *   Mistake:    0.10-0.20
 *   Blunder:    0.20+
 *
 * @param {object} ctx
 * @param {number} ctx.epLoss - expected points lost (0.0-1.0)
 * @param {number} ctx.epBefore - mover's EP before the move
 * @param {number} ctx.epAfter - mover's EP after the move
 * @param {number} ctx.epSecond - mover's EP had they played the 2nd-best move
 * @param {number} ctx.sacAmount - material sacrificed in pawns (>= 0)
 * @param {boolean} ctx.isBestMove - player's move matches engine's top choice
 * @param {boolean} ctx.isForced - only one legal move in the position
 * @param {boolean} ctx.isBookMove - resulting position is a named opening position
 */
export function classifyMove(ctx) {
  const {
    epLoss, epBefore, epAfter, epSecond,
    sacAmount, isBestMove, isForced, isBookMove,
  } = ctx;

  if (isBookMove) return { classification: 'book', glyph: '', epLoss };
  if (isForced) return { classification: 'forced', glyph: '', epLoss };

  const isNearBest = isBestMove || epLoss <= NEAR_BEST_EP_LOSS;

  // Brilliant: a sound material sacrifice that is best/near-best, where you
  // weren't already winning and aren't losing afterward.
  if (
    isNearBest
    && sacAmount >= SAC_MIN_PAWNS
    && epBefore <= BRILLIANT_NOT_WINNING
    && epAfter >= BRILLIANT_NOT_LOSING
  ) {
    return { classification: 'brilliant', glyph: '!!', epLoss };
  }

  // Great: the only good move — a clear gap to the 2nd-best alternative.
  if (isNearBest && (epBefore - epSecond) >= GREAT_ONLY_MOVE_GAP) {
    return { classification: 'great', glyph: '!', epLoss };
  }

  if (isBestMove) return { classification: 'best', glyph: '', epLoss };
  if (epLoss <= NEAR_BEST_EP_LOSS) return { classification: 'excellent', glyph: '', epLoss };
  if (epLoss <= 0.05) return { classification: 'good', glyph: '', epLoss };

  // Miss: a mistake-or-worse that specifically threw away a winning position.
  if (epLoss >= 0.10 && epBefore >= MISS_HAD_WIN && epAfter <= MISS_LOST_WIN) {
    return { classification: 'miss', glyph: '?', epLoss };
  }

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
  const onMoveAnalyzed = options.onMoveAnalyzed || (() => {});
  const isCancelled = options.isCancelled || (() => false);

  const totalPositions = positions.length;
  const evals = [];
  const classifications = [null]; // index 0 = starting position

  // Ensure clean engine state. MultiPV=2 so we know the 2nd-best move's eval,
  // which is needed to detect "Great" (the only good move) classifications.
  await sfController.stopAndWait();
  sfController.setMultiPV(2);
  await sfController.stopAndWait();

  for (let i = 0; i < totalPositions; i++) {
    if (isCancelled()) return;

    const { fen } = positions[i];
    const isBlackToMove = fen.split(' ')[1] === 'b';

    onProgress(i, totalPositions);

    const terminalEval = getTerminalPositionEval(fen);
    const result = terminalEval ? null : await sfController.analyzeAndWait(fen, depth);
    if (isCancelled()) return;

    const displayScore = terminalEval?.score
      || normalizeScoreToWhite(result?.score, isBlackToMove)
      || { type: 'cp', value: 0 };
    const whiteNormalizedCp = terminalEval?.whiteNormalizedCp ?? scoreToWhiteNormalizedCp(displayScore);

    // 2nd-best move's eval (white-normalized), null when unavailable.
    const secondDisplayScore = result?.secondScore
      ? normalizeScoreToWhite(result.secondScore, isBlackToMove)
      : null;
    const secondWhiteNormalizedCp = secondDisplayScore
      ? scoreToWhiteNormalizedCp(secondDisplayScore)
      : null;

    // Count legal moves for "forced" detection
    const legalMoveCount = countLegalMoves(fen);

    evals.push({
      whiteNormalizedCp,
      secondWhiteNormalizedCp,
      displayScore,
      bestMove: result?.bestMove || '',
      pv: result?.pv || [],
      legalMoveCount,
    });

    // Classify the move immediately once we have before and after evals
    if (i >= 1) {
      const ply = i;
      const evalBefore = evals[ply - 1];
      const evalAfter = evals[ply];
      const isWhiteMove = ply % 2 === 1;

      const epBefore = expectedPointsForMover(evalBefore.whiteNormalizedCp, isWhiteMove);
      const epAfter = expectedPointsForMover(evalAfter.whiteNormalizedCp, isWhiteMove);
      const epLoss = Math.max(0, epBefore - epAfter);

      // EP the mover would have had playing the engine's 2nd-best move.
      // Falls back to epBefore (no gap) when a 2nd line wasn't available.
      const epSecond = evalBefore.secondWhiteNormalizedCp != null
        ? expectedPointsForMover(evalBefore.secondWhiteNormalizedCp, isWhiteMove)
        : epBefore;

      const engineBestUci = evalBefore.bestMove || '';
      const playerMoveUci = positions[ply].uci || '';
      const isBestMove = engineBestUci && playerMoveUci && engineBestUci === playerMoveUci;
      const isForced = evalBefore.legalMoveCount === 1;
      const opening = getPrimaryOpening(positions[ply].fen);
      const isBookMove = Boolean(opening);

      // Material sacrificed by this move (walks the post-move engine PV to
      // settle recaptures). Used for Brilliant detection.
      const sacAmount = detectSacrifice(positions[ply - 1].fen, playerMoveUci, evalAfter.pv);

      const classification = classifyMove({
        epLoss, epBefore, epAfter, epSecond,
        sacAmount, isBestMove, isForced, isBookMove,
      });
      const cls = {
        ...classification,
        opening,
        evalBefore: evalBefore.whiteNormalizedCp,
        evalAfter: evalAfter.whiteNormalizedCp,
        evalBeforeScore: evalBefore.displayScore,
        evalAfterScore: evalAfter.displayScore,
        engineBestMove: engineBestUci,
        enginePv: evalBefore.pv,
        sacAmount,
        isSacrifice: sacAmount >= SAC_MIN_PAWNS,
        secondBestEval: evalBefore.secondWhiteNormalizedCp,
      };

      classifications.push(cls);
      onMoveAnalyzed(ply, cls);
    }
  }

  onProgress(totalPositions, totalPositions);
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
