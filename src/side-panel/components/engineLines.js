// Engine lines display component.
// Shows multi-PV Stockfish output with eval + SAN moves.
// Each move is individually hoverable/clickable to preview engine lines on the board.

import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci, makeUci } from 'chessops/util';
import { getPrimaryOpening } from '../../shared/openings.js';

/**
 * @param {HTMLElement} container
 */
export function createEngineLines(container) {
  let currentFen = null;
  let lines = new Map(); // multipv index -> line data
  let maxLines = 3; // current MultiPV setting
  let onLineCountChange = null;
  let moveHoverCallback = null;   // (fen, uciMove) => void
  let moveLeaveCallback = null;   // () => void
  let moveClickCallback = null;   // (moves: {fen, san, uci}[]) => void
  let clickedLineKey = null;       // track which line+move is "locked"
  let finalized = false;           // true after engine sends bestmove
  let mouseMovedSinceRender = false; // true only after real mouse movement
  let lastMouseX = -1;
  let lastMouseY = -1;

  // Track real mouse movement at the container level via coordinates
  container.addEventListener('mousemove', (e) => {
    if (e.clientX !== lastMouseX || e.clientY !== lastMouseY) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      mouseMovedSinceRender = true;
    }
  });

  function render() {
    container.innerHTML = '';
    mouseMovedSinceRender = false;

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

    const renderLines = sorted.map(([pvIndex, line]) => ({
      pvIndex,
      line,
      moveData: uciToSanWithPositions(currentFen, line.pv),
    }));

    for (const renderLine of renderLines) {
      renderLine.lineOpening = getLineOpeningMatch(renderLine.moveData);
    }

    const showOpeningColumn = renderLines.some((renderLine) => Boolean(renderLine.lineOpening));

    for (const { pvIndex, line, moveData, lineOpening } of renderLines) {
      const div = document.createElement('div');
      div.className = 'engine-line';

      if (showOpeningColumn) {
        const openingSpan = document.createElement('span');
        openingSpan.className = 'engine-line-opening';
        openingSpan.textContent = lineOpening?.opening.name || '';
        openingSpan.title = lineOpening ? `${lineOpening.opening.eco} ${lineOpening.opening.name}` : '';
        div.appendChild(openingSpan);
      }

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

      // PV moves in SAN — each move is an interactive span
      const movesSpan = document.createElement('span');
      movesSpan.className = 'engine-line-moves';

      // Determine starting fullmove number and turn from FEN
      const fenParts = currentFen ? currentFen.split(' ') : [];
      const startTurnIsBlack = fenParts[1] === 'b';
      const startFullmove = parseInt(fenParts[5], 10) || 1;

      let openingPrefixSpan = null;
      if (lineOpening?.prefixLength > 0) {
        openingPrefixSpan = document.createElement('span');
        openingPrefixSpan.className = 'engine-line-opening-prefix';
      }

      for (let i = 0; i < moveData.length; i++) {
        const m = moveData[i];
        const isBlackMove = (startTurnIsBlack && i % 2 === 0) || (!startTurnIsBlack && i % 2 === 1);
        const isWhiteMove = !isBlackMove;
        const inOpeningPrefix = i < (lineOpening?.prefixLength || 0);

        // Move number: show before white moves, or before first move if black
        if (isWhiteMove) {
          const moveNum = startTurnIsBlack
            ? startFullmove + Math.ceil((i + 1) / 2)
            : startFullmove + Math.floor(i / 2);
          const numSpan = document.createElement('span');
          numSpan.className = inOpeningPrefix ? 'engine-line-num engine-line-opening-num' : 'engine-line-num';
          numSpan.textContent = inOpeningPrefix ? `${moveNum}.\u00A0` : `${moveNum}.\u2009`;
          appendMoveToken(movesSpan, openingPrefixSpan, numSpan, inOpeningPrefix);
        } else if (i === 0) {
          // First move is black: show "N..."
          const numSpan = document.createElement('span');
          numSpan.className = inOpeningPrefix ? 'engine-line-num engine-line-opening-num' : 'engine-line-num';
          numSpan.textContent = inOpeningPrefix ? `${startFullmove}\u2026\u00A0` : `${startFullmove}\u2026\u2009`;
          appendMoveToken(movesSpan, openingPrefixSpan, numSpan, inOpeningPrefix);
        }

        const moveSpan = document.createElement('span');
        moveSpan.className = inOpeningPrefix ? 'engine-line-move engine-line-opening-move' : 'engine-line-move';
        const isLastOpeningMove = lineOpening?.prefixLength === i + 1;
        moveSpan.textContent = inOpeningPrefix && !isLastOpeningMove ? `${m.san}\u00A0` : m.san;
        moveSpan.dataset.pvIndex = pvIndex;
        moveSpan.dataset.moveIndex = i;

        // Slice of moves up to and including this one
        const movesUpTo = moveData.slice(0, i + 1);

        moveSpan.addEventListener('mouseenter', () => {
          if (!finalized || !mouseMovedSinceRender) return;
          if (moveHoverCallback) moveHoverCallback(m.fen, m.uci);
        });

        moveSpan.addEventListener('mouseleave', () => {
          if (moveLeaveCallback) moveLeaveCallback();
        });

        moveSpan.addEventListener('click', () => {
          if (!finalized) return;
          clickedLineKey = `${pvIndex}-${i}`;
          mouseMovedSinceRender = false;
          if (moveClickCallback) moveClickCallback(movesUpTo);
        });

        appendMoveToken(movesSpan, openingPrefixSpan, moveSpan, inOpeningPrefix);

        // Add space between moves
        if (i < moveData.length - 1) {
          if (!inOpeningPrefix || isLastOpeningMove) {
            movesSpan.appendChild(document.createTextNode(' '));
          }
        }
      }

      if (openingPrefixSpan) {
        movesSpan.prepend(openingPrefixSpan);
      }

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
      clickedLineKey = null;
      finalized = false;
      mouseMovedSinceRender = false;
      lines.clear();
      render();
    },

    /** Mark lines as finalized (engine sent bestmove) — enables hover/click */
    setFinalized() {
      finalized = true;
    },

    /** Set the maximum number of lines (MultiPV) */
    setMaxLines(n) { maxLines = n; render(); },

    /** Register callback when rendered line count changes */
    onLineCountChange(fn) { onLineCountChange = fn; },

    /** Register callback when a move is hovered */
    onMoveHover(fn) { moveHoverCallback = fn; },

    /** Register callback when mouse leaves a move */
    onMoveLeave(fn) { moveLeaveCallback = fn; },

    /** Register callback when a move is clicked */
    onMoveClick(fn) { moveClickCallback = fn; },

    /** Get the best eval from multipv 1 */
    getBestEval() {
      return lines.get(1)?.score || null;
    },

    /** Get the best move (first move of PV 1) in UCI notation */
    getBestMove() {
      return lines.get(1)?.pv?.[0] || null;
    },
  };
}

function getLineOpeningMatch(moveData) {
  for (let i = 0; i < moveData.length; i++) {
    const opening = getPrimaryOpening(moveData[i].fen);
    if (opening) {
      return { opening, prefixLength: i + 1 };
    }
  }

  return null;
}

function appendMoveToken(movesSpan, openingPrefixSpan, token, inOpeningPrefix) {
  if (inOpeningPrefix && openingPrefixSpan) {
    openingPrefixSpan.appendChild(token);
    return;
  }

  movesSpan.appendChild(token);
}

/**
 * Convert a sequence of UCI moves to SAN notation with intermediate positions.
 * @param {string} fen - starting position
 * @param {string[]} uciMoves - moves in UCI notation
 * @returns {{san: string, fen: string, uci: string}[]}
 */
function uciToSanWithPositions(fen, uciMoves) {
  if (!fen || !uciMoves?.length) return [];

  const setup = parseFen(fen);
  if (setup.isErr) return uciMoves.map(u => ({ san: u, fen, uci: u }));

  const chess = Chess.fromSetup(setup.value);
  if (chess.isErr) return uciMoves.map(u => ({ san: u, fen, uci: u }));

  const pos = chess.value;
  const result = [];

  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move) break;
    if (!pos.isLegal(move)) break;

    try {
      const san = makeSan(pos, move);
      const normalUci = makeUci(move);
      pos.play(move);
      const newFen = makeFen(pos.toSetup());
      result.push({ san, fen: newFen, uci: normalUci });
    } catch {
      break;
    }
  }

  return result;
}
