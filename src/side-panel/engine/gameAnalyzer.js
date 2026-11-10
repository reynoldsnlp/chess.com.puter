// Full game analysis engine.
// Uses chess.com's Expected Points model for move classification.
// Expected Points = win probability on a 0.0-1.0 scale.
// "Expected Points Lost" = how much win probability the move cost.
// See MOVE_CLASSIFICATION.md for the research behind these rules and sources.

import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { isSameMove } from '../../shared/chessUtils.js';
import { getPrimaryOpening } from '../../shared/openings.js';
import {
  getTerminalPositionEval,
  normalizeScoreToWhite,
  scoreToWhiteNormalizedCp,
  whitePerspectiveScoreSign,
} from '../evalUtils.js';
import { analyzeMoveTactics, materialLostByMove } from './moveHeuristics.js';

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
// EP values are from the mover's perspective on the 0.0-1.0 scale; cp values
// are mover-perspective centipawns (mate = +/-MATE_CP).
const MATE_CP = 10000;              // scoreToWhiteNormalizedCp maps mate to this
const STILL_WINNING_CP = 700;       // winning by this much without the move = nothing special
const NEAR_BEST_EP_LOSS = 0.02;     // "best or nearly best"
const GREAT_ONLY_MOVE_GAP = 0.10;   // 2nd-best move must lose >= this much EP
const MISS_OPPONENT_ERROR = 0.10;   // opponent's previous move lost >= this (a mistake or worse)
const MISS_HAD_WIN = 0.75;          // ...giving the mover a clear winning chance
const MISS_LOST_WIN = 0.55;         // ...which is gone after the mover's reply
const BLUNDER_MIN_MATERIAL = 1;     // a blunder must lose >= this many pawns (or allow mate)

/**
 * Preliminary filter for Brilliant and Great: the move must matter. Moves
 * that are forced by check, queen promotions, moves in losing positions, and
 * moves where you'd still be completely winning without them don't qualify.
 */
function isCriticalCandidate({ moverCpAfter, moverCpSecond, promotion, wasInCheck }) {
  const winningAnyway = moverCpSecond != null
    ? moverCpSecond >= STILL_WINNING_CP
    : moverCpAfter >= STILL_WINNING_CP;
  if (winningAnyway) return false;
  if (moverCpAfter < 0) return false;
  if (promotion === 'queen') return false;
  if (wasInCheck) return false;
  return true;
}

/**
 * Classify a move using chess.com's Expected Points model, including the
 * special Brilliant/Great/Miss classifications (Brilliant/Great follow
 * WintrChess's rules; see moveHeuristics.js). Thresholds and their sources
 * are documented in MOVE_CLASSIFICATION.md (sections 3 and 7).
 *
 * Expected Points Lost thresholds (0.0-1.0 scale):
 *   Best:       0.00        (matches engine's top choice)
 *   Excellent:  0.00-0.02
 *   Good:       0.02-0.05
 *   Inaccuracy: 0.05-0.10
 *   Mistake:    0.10-0.20
 *   Blunder:    0.20+
 *
 * Brilliant: engine's top move, passes isCriticalCandidate, not a promotion,
 *   and is a genuine sacrifice (leaves a piece en prise that isn't poisoned
 *   or already lost).
 * Great: engine's top move, passes isCriticalCandidate, doesn't already have
 *   a forced mate, isn't a capture of free material (e.g. a recapture), and
 *   the 2nd-best move would have lost >= 0.10 EP.
 * Blunder: > 0.20 EP lost AND the move loses material or allows a forced
 *   mate (chess.com's rule). A large drop without either is a Mistake.
 * Miss: the opponent just erred (lost >= 0.10 EP), handing the mover a
 *   winning position (>= 0.75), and the mover's reply (>= 0.10 lost) gives it
 *   back (<= 0.55) without itself being a blunder. Fails to punish a mistake.
 *
 * @param {object} ctx
 * @param {number} ctx.epLoss - expected points lost (0.0-1.0)
 * @param {number} ctx.epBefore - mover's EP before the move (best line)
 * @param {number} ctx.epAfter - mover's EP after the move
 * @param {number|null} ctx.epSecond - mover's EP for the 2nd-best move (null if unknown)
 * @param {number} ctx.moverCpAfter - mover-perspective cp after the move
 * @param {number|null} ctx.moverCpSecond - mover-perspective cp of the 2nd-best move
 * @param {boolean} ctx.isBestMove - player's move matches engine's top choice
 * @param {boolean} ctx.isForced - only one legal move in the position
 * @param {boolean} ctx.isBookMove - resulting position is a named opening position
 * @param {object} [ctx.tactics] - output of analyzeMoveTactics()
 * @param {number|null} [ctx.opponentEpLoss] - EP the opponent lost on the previous ply
 * @param {number} [ctx.materialLost] - pawns the move loses vs. the best line
 * @param {boolean} [ctx.allowsMate] - the move allows a forced mate against the mover
 */
export function classifyMove(ctx) {
  const {
    epLoss, epBefore, epAfter, epSecond = null,
    moverCpAfter = 0, moverCpSecond = null,
    isBestMove, isForced, isBookMove,
    tactics = {},
    opponentEpLoss = null, materialLost = 0, allowsMate = false,
  } = ctx;

  if (isBookMove) return { classification: 'book', glyph: '', epLoss };
  if (isForced) return { classification: 'forced', glyph: '', epLoss };
  if (tactics.isCheckmate) return { classification: 'best', glyph: '', epLoss };

  if (isBestMove) {
    const candidate = isCriticalCandidate({
      moverCpAfter, moverCpSecond,
      promotion: tactics.promotion, wasInCheck: tactics.wasInCheck,
    });

    if (candidate && !tactics.promotion && tactics.isSacrifice) {
      return { classification: 'brilliant', glyph: '!!', epLoss };
    }

    if (
      candidate
      && moverCpAfter < MATE_CP
      && !tactics.capturedFreeMaterial
      && epSecond != null
      && (epBefore - epSecond) >= GREAT_ONLY_MOVE_GAP
    ) {
      return { classification: 'great', glyph: '!', epLoss };
    }

    return { classification: 'best', glyph: '', epLoss };
  }

  if (epLoss <= NEAR_BEST_EP_LOSS) return { classification: 'excellent', glyph: '', epLoss };
  if (epLoss <= 0.05) return { classification: 'good', glyph: '', epLoss };

  // Blunder: a big drop that concretely loses material or allows mate.
  if (epLoss > 0.20 && (allowsMate || materialLost >= BLUNDER_MIN_MATERIAL)) {
    return { classification: 'blunder', glyph: '??', epLoss };
  }

  // Miss: failed to punish the opponent's mistake.
  if (
    epLoss >= 0.10
    && opponentEpLoss != null && opponentEpLoss >= MISS_OPPONENT_ERROR
    && epBefore >= MISS_HAD_WIN
    && epAfter <= MISS_LOST_WIN
  ) {
    return { classification: 'miss', glyph: '?', epLoss };
  }

  if (epLoss <= 0.10) return { classification: 'inaccuracy', glyph: '?!', epLoss };
  // Includes drops > 0.20 that lose no material and allow no mate.
  return { classification: 'mistake', glyph: '?', epLoss };
}

/**
 * Evaluate one position with the engine (MultiPV should already be 2).
 * Terminal positions (mate/stalemate) are scored without searching.
 * @returns {Promise<{
 *   whiteNormalizedCp: number, secondWhiteNormalizedCp: number|null,
 *   displayScore: object, bestMove: string, pv: string[], legalMoveCount: number
 * }>}
 */
export async function evaluatePosition(fen, sfController, depth = 16) {
  const isBlackToMove = fen.split(' ')[1] === 'b';
  const terminalEval = getTerminalPositionEval(fen);
  const result = terminalEval ? null : await sfController.analyzeAndWait(fen, depth);

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

  return {
    whiteNormalizedCp,
    secondWhiteNormalizedCp,
    displayScore,
    bestMove: result?.bestMove || '',
    pv: result?.pv || [],
    legalMoveCount: countLegalMoves(fen),
  };
}

/**
 * Classify the move that leads to positions[ply], given engine evaluations
 * of the positions before and after it.
 *
 * @param {Array<{fen: string, uci: string|null}>} positions - line from its start
 * @param {number} ply - index of the position reached by the move (>= 1)
 * @param {object} evalBefore - evaluatePosition() result for positions[ply - 1]
 * @param {object} evalAfter - evaluatePosition() result for positions[ply]
 * @param {object|null} previousCls - classification of the move before (for Miss)
 */
export function classifyPly(positions, ply, evalBefore, evalAfter, previousCls = null) {
  const fenBefore = positions[ply - 1].fen;
  const isWhiteMove = fenBefore.split(' ')[1] !== 'b';

  const epBefore = expectedPointsForMover(evalBefore.whiteNormalizedCp, isWhiteMove);
  const epAfter = expectedPointsForMover(evalAfter.whiteNormalizedCp, isWhiteMove);
  const epLoss = Math.max(0, epBefore - epAfter);

  // EP/cp the mover would have had playing the engine's 2nd-best move
  // (null when a 2nd line wasn't available).
  const toMover = (wnc) => (isWhiteMove ? wnc : -wnc);
  const secondWnc = evalBefore.secondWhiteNormalizedCp;
  const epSecond = secondWnc != null ? expectedPointsForMover(secondWnc, isWhiteMove) : null;
  const moverCpSecond = secondWnc != null ? toMover(secondWnc) : null;
  const moverCpAfter = toMover(evalAfter.whiteNormalizedCp);

  const engineBestUci = evalBefore.bestMove || '';
  const playerMoveUci = positions[ply].uci || '';
  const isBestMove = isSameMove(fenBefore, engineBestUci, playerMoveUci);
  const isForced = evalBefore.legalMoveCount === 1;
  const opening = getPrimaryOpening(positions[ply].fen);
  const isBookMove = Boolean(opening);

  // Static board facts (sacrifice, free capture, check, promotion). Only
  // the engine's top move can be Brilliant/Great, so skip the work otherwise.
  const tactics = isBestMove && !isBookMove && !isForced
    ? analyzeMoveTactics(fenBefore, playerMoveUci)
    : null;

  // EP the opponent lost on the previous ply (for Miss).
  const opponentEpLoss = previousCls?.epLoss ?? null;

  // Concrete damage (for Blunder); only needed for big drops.
  let materialLost = 0;
  let allowsMate = false;
  if (epLoss > 0.20) {
    materialLost = materialLostByMove(
      fenBefore, playerMoveUci, evalAfter.pv, evalBefore.pv,
      ply >= 2 ? positions[ply - 2].fen : null,
    );
    const afterScore = evalAfter.displayScore;
    allowsMate = afterScore?.type === 'mate'
      && whitePerspectiveScoreSign(afterScore) === (isWhiteMove ? -1 : 1);
  }

  const classification = classifyMove({
    epLoss, epBefore, epAfter, epSecond,
    moverCpAfter, moverCpSecond,
    isBestMove, isForced, isBookMove,
    tactics: tactics || undefined,
    opponentEpLoss, materialLost, allowsMate,
  });
  return {
    ...classification,
    opening,
    evalBefore: evalBefore.whiteNormalizedCp,
    evalAfter: evalAfter.whiteNormalizedCp,
    evalBeforeScore: evalBefore.displayScore,
    evalAfterScore: evalAfter.displayScore,
    engineBestMove: engineBestUci,
    enginePv: evalBefore.pv,
    materialLost,
    allowsMate,
    isSacrifice: Boolean(tactics?.isSacrifice),
    sacrificedPieces: tactics?.sacrificedPieces || [],
    secondBestEval: evalBefore.secondWhiteNormalizedCp,
  };
}

/**
 * Run full game analysis.
 * @param {Array<{fen: string, san: string|null, uci: string|null}>} positions
 * @param {object} sfController
 * @param {object} options
 * @param {Map<string, object>} [options.evalCache] - filled with each
 *   position's evaluation (keyed by FEN) so variations can reuse them
 */
export async function analyzeGame(positions, sfController, options = {}) {
  const depth = options.depth || 16;
  const onProgress = options.onProgress || (() => {});
  const onComplete = options.onComplete || (() => {});
  const onMoveAnalyzed = options.onMoveAnalyzed || (() => {});
  const isCancelled = options.isCancelled || (() => false);
  const evalCache = options.evalCache || null;

  const totalPositions = positions.length;
  const evals = [];
  const classifications = [null]; // index 0 = starting position

  // Ensure clean engine state. MultiPV=2 so we know the 2nd-best move's eval,
  // which is needed for the Great (only good move) and "winning anyway" checks.
  await sfController.stopAndWait();
  sfController.setMultiPV(2);
  await sfController.stopAndWait();

  for (let i = 0; i < totalPositions; i++) {
    if (isCancelled()) return;
    onProgress(i, totalPositions);

    const evaluation = await evaluatePosition(positions[i].fen, sfController, depth);
    if (isCancelled()) return;
    evals.push(evaluation);
    evalCache?.set(positions[i].fen, evaluation);

    // Classify the move immediately once we have before and after evals
    if (i >= 1) {
      const cls = classifyPly(positions, i, evals[i - 1], evals[i], classifications[i - 1]);
      classifications.push(cls);
      onMoveAnalyzed(i, cls);
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
