// Shared chess utilities.

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
