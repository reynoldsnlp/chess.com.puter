// Heuristics for chess.com's "special" move classifications.
// These are deterministic rules layered on top of the Expected Points model
// (see gameAnalyzer.js) — no training data required.

import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { Material } from 'chessops/setup';
import { parseUci } from 'chessops/util';

const ROLES = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
const PIECE_VALUES = { queen: 9, rook: 5, bishop: 3, knight: 3, pawn: 1 };

// How many plies of the engine continuation to walk before measuring the
// "settled" material balance. Long enough to resolve an immediate tactical
// sequence (recaptures), short enough to stay cheap.
const SETTLE_PLIES = 10;

function materialSideValue(side) {
  let total = 0;
  for (const role of ROLES) total += side[role] * PIECE_VALUES[role];
  return total;
}

/**
 * Material advantage (in pawns) from a given color's perspective for a position.
 * Returns null if the FEN cannot be parsed.
 */
function moverAdvantage(pos, moverColor) {
  const material = Material.fromBoard(pos.board);
  const white = materialSideValue(material.white);
  const black = materialSideValue(material.black);
  const diff = white - black;
  return moverColor === 'white' ? diff : -diff;
}

/**
 * Detect a material sacrifice by the player who just moved.
 *
 * Approach: measure the mover's material advantage before the move, then walk
 * the engine's best continuation (which resolves any forced recaptures) and
 * measure it again. The net material the mover gave up is the difference. A
 * genuine sacrifice nets a loss because the eval — not the material — provides
 * the compensation; a simple trade or a fully-recoverable hang nets ~0.
 *
 * @param {string} fenBefore - FEN before the played move (mover is to move)
 * @param {string} playedUci - the move played, in UCI notation
 * @param {string[]} continuationPv - engine PV from the position AFTER the move
 *   (i.e. the opponent's best reply onward)
 * @returns {number} pawns of material sacrificed (>= 0; 0 if none/unparseable)
 */
export function detectSacrifice(fenBefore, playedUci, continuationPv) {
  if (!fenBefore || !playedUci) return 0;

  const setup = parseFen(fenBefore);
  if (setup.isErr) return 0;
  const chess = Chess.fromSetup(setup.value);
  if (chess.isErr) return 0;

  const pos = chess.value;
  const moverColor = pos.turn;
  const advBefore = moverAdvantage(pos, moverColor);

  // Play the move itself.
  const played = parseUci(playedUci);
  if (!played || !pos.isLegal(played)) return 0;
  pos.play(played);

  // Walk the engine continuation to settle recaptures.
  const pv = continuationPv || [];
  for (let i = 0; i < pv.length && i < SETTLE_PLIES; i++) {
    const move = parseUci(pv[i]);
    if (!move || !pos.isLegal(move)) break;
    pos.play(move);
  }

  const advSettled = moverAdvantage(pos, moverColor);
  return Math.max(0, advBefore - advSettled);
}
