import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';

export function whitePerspectiveScoreSign(score) {
  if (!score) return 0;
  if (score.type === 'mate' && score.winner) {
    return score.winner === 'white' ? 1 : -1;
  }

  const value = Number(score.value) || 0;
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

export function scoreToWhiteNormalizedCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') {
    const sign = whitePerspectiveScoreSign(score);
    return sign > 0 ? 10000 : sign < 0 ? -10000 : 0;
  }
  return Number(score.value) || 0;
}

export function normalizeScoreToWhite(score, isBlackToMove = false, terminalWinner = null) {
  if (!score) return null;

  if (score.type === 'mate') {
    const value = isBlackToMove ? -score.value : score.value;
    const winner = terminalWinner
      || (value > 0 ? 'white' : value < 0 ? 'black' : null);
    return winner ? { type: 'mate', value, winner } : { type: 'mate', value };
  }

  return {
    type: 'cp',
    value: isBlackToMove ? -score.value : score.value,
  };
}

export function getTerminalPositionEval(fen) {
  try {
    const setup = parseFen(fen);
    if (setup.isErr) return null;

    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return null;

    const outcome = pos.value.outcome();
    if (!outcome) return null;

    if (outcome.winner) {
      return {
        kind: 'checkmate',
        score: { type: 'mate', value: 0, winner: outcome.winner },
        whiteNormalizedCp: outcome.winner === 'white' ? 10000 : -10000,
      };
    }

    return {
      kind: 'draw',
      score: { type: 'cp', value: 0 },
      whiteNormalizedCp: 0,
    };
  } catch {
    return null;
  }
}

export function formatEvalScore(score, options = {}) {
  const { cpDecimals = 1, showPlus = true } = options;

  if (!score) {
    return (0).toFixed(cpDecimals);
  }

  if (score.type === 'mate') {
    return `M${Math.abs(score.value)}`;
  }

  const pawns = (Number(score.value) || 0) / 100;
  const sign = pawns > 0 || (showPlus && Object.is(pawns, 0));
  return `${sign ? '+' : ''}${pawns.toFixed(cpDecimals)}`;
}
