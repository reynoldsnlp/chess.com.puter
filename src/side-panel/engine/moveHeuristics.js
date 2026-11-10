// Board heuristics for the special Brilliant/Great classifications.
//
// These are deterministic, static-board rules layered on top of the Expected
// Points model (see gameAnalyzer.js). The concepts follow WintrChess
// (https://github.com/WintrCat/wintrchess, GPL-3.0):
//   - a piece is "unsafe" when it can be won by the opponent (approximate SEE);
//   - a sacrifice is a move that leaves one of your pieces unsafe, unless the
//     piece was merely moved to safety, was trapped anyway, or taking it would
//     cost the opponent equal-or-greater material (or allow mate in one);
//   - capturing a piece that was unsafe is "free material", never a Great move.
// See MOVE_CLASSIFICATION.md (sections 4.1 and 7) for details and sources.

import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { SquareSet } from 'chessops/squareSet';
import { makeSquare, opposite, parseUci, squareRank } from 'chessops/util';

export const PIECE_VALUES = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: Infinity };

function value(role) {
  return PIECE_VALUES[role] ?? 0;
}

/** Copy of `pos` with `color` to move (en passant cleared if the turn changes). */
function withTurn(pos, color) {
  const copy = pos.clone();
  if (copy.turn !== color) {
    copy.turn = color;
    copy.epSquare = undefined;
  }
  return copy;
}

/** Build a legal move for `from`->`to`, auto-promoting pawns to a queen. */
function moveTo(pos, from, to) {
  const piece = pos.board.get(from);
  const rank = squareRank(to);
  const promotion = piece?.role === 'pawn' && (rank === 0 || rank === 7) ? 'queen' : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

/**
 * Pieces of `color` attacking `square`, including x-ray attackers lined up
 * behind them (batteries). `direct` holds only the front layer; when
 * `legalOnly` is set, direct attackers that can't legally capture (pinned
 * pieces, a king walking into a defended square) are dropped.
 */
function attackersOf(pos, square, color, legalOnly = false) {
  const board = pos.board;
  const mover = legalOnly ? withTurn(pos, color) : null;
  let occupied = board.occupied;
  let seen = SquareSet.empty();
  const direct = [];
  const all = [];

  for (let layer = 0; ; layer++) {
    const found = pos.kingAttackers(square, color, occupied).diff(seen);
    if (found.isEmpty()) break;
    for (const sq of found) {
      if (layer === 0 && mover && !mover.isLegal(moveTo(mover, sq, square))) continue;
      const entry = { square: sq, role: board.get(sq).role };
      if (layer === 0) direct.push(entry);
      all.push(entry);
    }
    seen = seen.union(found);
    occupied = occupied.diff(found);
  }
  return { direct, all };
}

/**
 * Is the piece on `square` safe from being won by the opponent?
 * @param {Chess} pos
 * @param {number} square
 * @param {string} [capturedRole] - role captured by the move that just landed
 *   on this square (enables the "rook for two minors" exception)
 */
export function isPieceSafe(pos, square, capturedRole) {
  const piece = pos.board.get(square);
  if (!piece) return true;

  const enemy = opposite(piece.color);
  const { direct, all: attackers } = attackersOf(pos, square, enemy, true);
  if (direct.length === 0) return true;
  const { all: defenders } = attackersOf(pos, square, piece.color);

  // A rook that just took a minor piece and can only be taken by a defended
  // minor is a favorable "rook for two minors" deal, not a loss.
  if (
    piece.role === 'rook'
    && value(capturedRole) === 3
    && attackers.length === 1
    && value(attackers[0].role) === 3
    && defenders.length > 0
  ) return true;

  const pieceValue = value(piece.role);
  const lowestAttacker = Math.min(...direct.map((a) => value(a.role)));

  // Attacked by something cheaper: losing the exchange no matter what.
  if (lowestAttacker < pieceValue) return false;
  // Defended at least as many times as attacked.
  if (attackers.length <= defenders.length) return true;
  // Cheaper than every attacker and backed by a defender cheaper than them too.
  if (pieceValue < lowestAttacker && defenders.some((d) => value(d.role) < lowestAttacker)) return true;
  // A pawn defender makes any capture a bad trade at this point.
  if (defenders.some((d) => d.role === 'pawn')) return true;
  return false;
}

/** Non-pawn, non-king pieces of `color` that are unsafe (worth more than `minValue`). */
export function getUnsafePieces(pos, color, { minValue = 0, capturedRole } = {}) {
  const unsafe = [];
  for (const square of pos.board[color]) {
    const role = pos.board.get(square).role;
    if (role === 'pawn' || role === 'king') continue;
    if (value(role) <= minValue) continue;
    if (!isPieceSafe(pos, square, capturedRole)) unsafe.push({ square, role });
  }
  return unsafe;
}

/** Can the side to move deliver checkmate in one? */
function hasMateInOne(pos) {
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const next = pos.clone();
      next.play(moveTo(pos, from, to));
      if (next.isCheckmate()) return true;
    }
  }
  return false;
}

/**
 * Unsafe pieces of `color` worth at least `threshold`, other than the one on
 * `excludeSquare`, that the opponent can actually capture.
 */
function capturableUnsafePieces(pos, color, threshold, excludeSquare) {
  return getUnsafePieces(pos, color).filter((p) => (
    p.square !== excludeSquare
    && value(p.role) >= threshold
    && attackersOf(pos, p.square, opposite(color), true).direct.length > 0
  ));
}

/**
 * After the opponent captures the threatened piece, are they left with an
 * equal-or-greater loss of their own (or does a cheap piece's capture allow
 * mate in one)? If every capture does, the "sacrifice" isn't real.
 */
function captureLeavesCounterThreat(posAfter, threatened) {
  const owner = posAfter.board.get(threatened.square).color;
  const enemy = opposite(owner);
  const threatenedValue = value(threatened.role);
  const enemyToMove = withTurn(posAfter, enemy);
  const { direct } = attackersOf(enemyToMove, threatened.square, enemy, true);

  return direct.every((attacker) => {
    const next = enemyToMove.clone();
    next.play(moveTo(next, attacker.square, threatened.square));
    if (capturableUnsafePieces(next, enemy, threatenedValue, threatened.square).length > 0) return true;
    return threatenedValue < PIECE_VALUES.queen && hasMateInOne(next);
  });
}

/**
 * Does moving `piece` with `move` hand the opponent a new equal-or-greater
 * target (or, for a cheap piece, mate in one)?
 */
function escapeCreatesGreaterThreat(pos, piece, move) {
  const threshold = value(piece.role);
  const before = new Set(
    capturableUnsafePieces(pos, piece.color, threshold, piece.square).map((p) => p.square),
  );
  const next = pos.clone();
  next.play(move);
  const created = capturableUnsafePieces(next, piece.color, threshold, move.to)
    .some((p) => !before.has(p.square));
  if (created) return true;
  return threshold < PIECE_VALUES.queen && hasMateInOne(next);
}

/** A piece is trapped if it's unsafe where it stands and on every square it can reach. */
export function isPieceTrapped(pos, square) {
  const piece = pos.board.get(square);
  if (!piece) return false;
  const own = withTurn(pos, piece.color);
  if (isPieceSafe(own, square)) return false;

  for (const to of own.dests(square)) {
    const move = moveTo(own, square, to);
    if (escapeCreatesGreaterThreat(own, { ...piece, square }, move)) continue;
    const captured = own.board.get(to)?.role;
    const next = own.clone();
    next.play(move);
    if (isPieceSafe(next, to, captured)) return false;
  }
  return true;
}

const NO_TACTICS = Object.freeze({
  legal: false,
  isCheckmate: false,
  wasInCheck: false,
  promotion: undefined,
  capturedFreeMaterial: false,
  isSacrifice: false,
  sacrificedPieces: [],
});

/**
 * Static tactical facts about a move, used for Brilliant/Great detection.
 *
 * @param {string} fenBefore - FEN before the move (mover to move)
 * @param {string} playedUci - the move, in UCI notation
 * @returns {{
 *   legal: boolean, isCheckmate: boolean, wasInCheck: boolean,
 *   promotion: string|undefined, capturedFreeMaterial: boolean,
 *   isSacrifice: boolean, sacrificedPieces: Array<{square: string, role: string}>
 * }}
 */
export function analyzeMoveTactics(fenBefore, playedUci) {
  if (!fenBefore || !playedUci) return NO_TACTICS;
  const setup = parseFen(fenBefore);
  if (setup.isErr) return NO_TACTICS;
  const chess = Chess.fromSetup(setup.value);
  if (chess.isErr) return NO_TACTICS;
  const before = chess.value;

  const parsed = parseUci(playedUci);
  if (!parsed || !('from' in parsed)) return NO_TACTICS;
  const move = normalizeMove(before, parsed);
  if (!before.isLegal(move)) return NO_TACTICS;

  const mover = before.turn;
  const enemy = opposite(mover);
  const movingRole = before.board.get(move.from).role;
  const isCastle = movingRole === 'king' && before.board.get(move.to)?.color === mover;

  // Square of the captured piece (differs from `to` for en passant).
  let captureSquare;
  if (!isCastle && before.board.get(move.to)?.color === enemy) captureSquare = move.to;
  else if (movingRole === 'pawn' && move.to === before.epSquare) captureSquare = move.to + (mover === 'white' ? -8 : 8);
  const capturedRole = captureSquare !== undefined ? before.board.get(captureSquare).role : undefined;

  // Taking a piece the opponent had left unsafe is free material.
  const capturedFreeMaterial = captureSquare !== undefined && !isPieceSafe(before, captureSquare);

  const after = before.clone();
  after.play(move);

  const result = {
    legal: true,
    isCheckmate: after.isCheckmate(),
    wasInCheck: before.isCheck(),
    promotion: move.promotion,
    capturedFreeMaterial,
    isSacrifice: false,
    sacrificedPieces: [],
  };

  const unsafeBefore = getUnsafePieces(before, mover);
  const unsafeAfter = getUnsafePieces(after, mover, { minValue: value(capturedRole), capturedRole });
  if (unsafeAfter.length === 0) return result;

  // Moving a piece out of danger isn't a sacrifice (unless it gives check).
  if (!after.isCheck() && unsafeAfter.length < unsafeBefore.length) return result;

  // Every "hanging" piece is poisoned: taking it costs at least as much.
  if (unsafeAfter.every((p) => captureLeavesCounterThreat(after, p))) return result;

  // Pieces that were lost anyway aren't being sacrificed.
  const trappedBefore = unsafeBefore.filter((p) => isPieceTrapped(before, p.square));
  const trappedAfter = unsafeAfter.filter((p) => isPieceTrapped(after, p.square));
  const movedPieceWasTrapped = trappedBefore.some((p) => p.square === move.from);
  if (
    trappedAfter.length === unsafeAfter.length
    || movedPieceWasTrapped
    || trappedAfter.length < trappedBefore.length
  ) return result;

  result.isSacrifice = true;
  result.sacrificedPieces = unsafeAfter.map((p) => ({ square: makeSquare(p.square), role: p.role }));
  return result;
}

// --- Material lost by a move (used to require concrete loss for Blunder) ---

// How far to follow an engine line before reading the material balance: long
// enough to settle an exchange or a short tactic, short enough to stay cheap.
const SETTLE_PLIES = 10;

/** Material balance in pawns from `color`'s point of view (kings excluded). */
function materialBalance(pos, color) {
  let total = 0;
  for (const square of pos.board.occupied) {
    const piece = pos.board.get(square);
    if (piece.role === 'king') continue;
    total += piece.color === color ? value(piece.role) : -value(piece.role);
  }
  return total;
}

/**
 * Follow `pv` from `pos` and return `color`'s material balance at the last
 * point where the opponent is to move (so we never stop halfway through an
 * exchange the opponent started). Returns null if no such point is reached.
 */
function settledBalance(pos, color, pv) {
  const walk = pos.clone();
  let last = walk.turn !== color ? materialBalance(walk, color) : null;
  for (let i = 0; i < pv.length && i < SETTLE_PLIES; i++) {
    const parsed = parseUci(pv[i]);
    if (!parsed || !('from' in parsed)) break;
    const move = normalizeMove(walk, parsed);
    if (!walk.isLegal(move)) break;
    walk.play(move);
    if (walk.turn !== color) last = materialBalance(walk, color);
  }
  return last;
}

/**
 * Pawns of material the played move loses, after the engine line is followed
 * until things settle. A big eval drop with no material loss (and no mate
 * allowed) is a positional error, not a blunder, matching chess.com's rule.
 *
 * The reference point is the balance before the opponent's last move (so
 * failing to recapture counts as a loss), capped at what the engine's best
 * line keeps (so a move that loses less than the best line isn't penalized).
 * Failing to *win* material the opponent offered is not a loss; that's a Miss.
 *
 * @param {string} fenBefore - FEN before the move (mover to move)
 * @param {string} playedUci - the move played
 * @param {string[]} pvAfter - engine line from the position after the move
 * @param {string[]} bestPv - engine line from the position before the move
 * @param {string} [fenPrevious] - FEN before the opponent's last move, if any
 * @returns {number} pawns lost (>= 0; 0 if unparseable)
 */
export function materialLostByMove(fenBefore, playedUci, pvAfter = [], bestPv = [], fenPrevious = null) {
  const before = positionFromFen(fenBefore);
  if (!before || !playedUci) return 0;
  const mover = before.turn;

  const parsed = parseUci(playedUci);
  if (!parsed || !('from' in parsed)) return 0;
  const move = normalizeMove(before, parsed);
  if (!before.isLegal(move)) return 0;
  const after = before.clone();
  after.play(move);

  const played = settledBalance(after, mover, pvAfter || []) ?? materialBalance(after, mover);
  const current = materialBalance(before, mover);
  const best = settledBalance(before, mover, bestPv || []) ?? current;
  const previous = positionFromFen(fenPrevious);
  const preExchange = previous ? materialBalance(previous, mover) : current;
  return Math.max(0, Math.min(best, preExchange) - played);
}

function positionFromFen(fen) {
  if (!fen) return null;
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const chess = Chess.fromSetup(setup.value);
  return chess.isErr ? null : chess.value;
}
