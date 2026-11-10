// Shared chess utilities.

import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';

/**
 * Normalize a UCI move for display purposes.
 * chessops outputs castling as king-captures-rook (e1h1, e1a1, e8h8, e8a8).
 * This converts to the standard king-destination format (e1g1, e1c1, etc.)
 * and returns the king's actual landing square.
 */
const CASTLING_MAP = {
  'e1h1': { uci: 'e1g1', from: 'e1', to: 'g1' }, // white kingside
  'e1a1': { uci: 'e1c1', from: 'e1', to: 'c1' }, // white queenside
  'e8h8': { uci: 'e8g8', from: 'e8', to: 'g8' }, // black kingside
  'e8a8': { uci: 'e8c8', from: 'e8', to: 'c8' }, // black queenside
};

/**
 * Get the display-friendly from/to squares for a UCI move.
 * Handles castling normalization.
 * @param {string} uci - UCI move (e.g., 'e2e4', 'e1h1')
 * @returns {{ from: string, to: string }}
 */
export function uciSquares(uci) {
  if (!uci || uci.length < 4) return { from: '', to: '' };
  const castling = CASTLING_MAP[uci];
  if (castling) return { from: castling.from, to: castling.to };
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

/**
 * Do two UCI strings denote the same move in the position `fen`?
 * Castling may be written as the king's destination (Stockfish: e1g1) or as
 * king-captures-rook (chessops: e1h1); both normalize to the same move.
 * @param {string} fen - position before the move
 * @param {string} uciA
 * @param {string} uciB
 * @returns {boolean}
 */
export function isSameMove(fen, uciA, uciB) {
  if (!uciA || !uciB) return false;
  if (uciA === uciB) return true;
  const a = parseUci(uciA);
  const b = parseUci(uciB);
  if (!a || !b || !('from' in a) || !('from' in b)) return false;

  const setup = parseFen(fen || '');
  if (setup.isErr) return false;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return false;

  const na = normalizeMove(pos.value, a);
  const nb = normalizeMove(pos.value, b);
  return na.from === nb.from && na.to === nb.to && na.promotion === nb.promotion;
}
