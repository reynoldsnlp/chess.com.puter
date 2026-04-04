// Engine lines display component.
// Shows multi-PV Stockfish output with eval + SAN moves.

import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';

/**
 * @param {HTMLElement} container
 */
export function createEngineLines(container) {
  let currentFen = null;
  let lines = new Map(); // multipv index -> line data
  let maxLines = 3; // current MultiPV setting
  let onLineCountChange = null;

  function render() {
    container.innerHTML = '';

    // Prune lines that exceed the current MultiPV setting
    for (const key of lines.keys()) {
      if (key > maxLines) lines.delete(key);
    }

    if (lines.size === 0) {
      container.innerHTML = '<div class="engine-lines-empty">Engine idle</div>';
      if (onLineCountChange) onLineCountChange(0);
      return;
    }

    // Sort by multipv index
    const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]);

    for (const [, line] of sorted) {
      const div = document.createElement('div');
      div.className = 'engine-line';

      // Eval score
      const evalSpan = document.createElement('span');
      evalSpan.className = 'engine-line-eval';
      if (line.score.type === 'mate') {
        evalSpan.textContent = `M${Math.abs(line.score.value)}`;
        evalSpan.classList.add(line.score.value > 0 ? 'eval-positive' : 'eval-negative');
      } else {
        const pawns = line.score.value / 100;
        evalSpan.textContent = (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
        evalSpan.classList.add(pawns >= 0 ? 'eval-positive' : 'eval-negative');
      }
      div.appendChild(evalSpan);

      // PV moves in SAN
      const movesSpan = document.createElement('span');
      movesSpan.className = 'engine-line-moves';
      movesSpan.textContent = uciToSan(currentFen, line.pv).join(' ');
      div.appendChild(movesSpan);

      // Depth
      const depthSpan = document.createElement('span');
      depthSpan.className = 'engine-line-depth';
      depthSpan.textContent = `d${line.depth}`;
      div.appendChild(depthSpan);

      container.appendChild(div);
    }
  }

  return {
    /**
     * Update a single PV line from engine info.
     * @param {object} info - parsed UCI info: { multipv, depth, score, pv }
     */
    updateLine(info) {
      if (info.multipv > maxLines) return; // ignore lines beyond current setting
      lines.set(info.multipv, {
        depth: info.depth,
        score: info.score,
        pv: info.pv || [],
      });
      render();
      if (onLineCountChange) onLineCountChange(lines.size);
    },

    /** Set the current position FEN (for UCI-to-SAN conversion) */
    setFen(fen) {
      currentFen = fen;
    },

    /** Clear all lines (e.g., when position changes) */
    clear() {
      lines.clear();
      render();
    },

    /** Set the maximum number of lines (MultiPV) */
    setMaxLines(n) { maxLines = n; render(); },

    /** Register callback when rendered line count changes */
    onLineCountChange(fn) { onLineCountChange = fn; },

    /** Get the best eval from multipv 1 */
    getBestEval() {
      return lines.get(1)?.score || null;
    },
  };
}

/**
 * Convert a sequence of UCI moves to SAN notation.
 * @param {string} fen - starting position
 * @param {string[]} uciMoves - moves in UCI notation (e.g., ['e2e4', 'e7e5'])
 * @returns {string[]} moves in SAN (e.g., ['e4', 'e5'])
 */
function uciToSan(fen, uciMoves) {
  if (!fen || !uciMoves?.length) return [];

  const setup = parseFen(fen);
  if (setup.isErr) return uciMoves; // Fallback to raw UCI

  const chess = Chess.fromSetup(setup.value);
  if (chess.isErr) return uciMoves;

  const pos = chess.value;
  const sans = [];

  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move) break;

    // Verify the move is legal
    if (!pos.isLegal(move)) break;

    try {
      const san = makeSan(pos, move);
      sans.push(san);
      pos.play(move);
    } catch {
      break;
    }
  }

  return sans;
}
