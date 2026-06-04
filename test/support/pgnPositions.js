// Convert a PGN string into the `positions` array shape that analyzeGame
// expects: [{ fen, san, uci }, ...] with index 0 = starting position.
// Mirrors the logic in src/side-panel/components/moveList.js so tests exercise
// the same position pipeline the app uses.

import { parsePgn, startingPosition } from 'chessops/pgn';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';
import { parseSan } from 'chessops/san';

export function pgnToPositions(pgn) {
  const games = parsePgn(pgn);
  if (!games?.length) throw new Error('no games in PGN');
  const game = games[0];

  const posResult = startingPosition(game.headers);
  if (posResult.isErr) throw new Error('bad starting position');
  const pos = posResult.value;

  const positions = [{ fen: makeFen(pos.toSetup()), san: null, uci: null }];

  for (const node of game.moves.mainline()) {
    const san = node.san;
    if (!san) break;
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal SAN in PGN: ${san}`);
    const uci = makeUci(move);
    pos.play(move);
    positions.push({ fen: makeFen(pos.toSetup()), san, uci });
  }

  return positions;
}
