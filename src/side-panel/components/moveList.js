// Vanilla JS move list component.
// Classification colors only applied to the detected player's moves.
// Glyphs (?!, ?, ??) shown for all moves.

import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';

export function createMoveList(container, onMoveSelect) {
  let positions = [];
  let classifications = [];
  let currentPly = 0;
  let myColor = 'white'; // which color is "me"

  function isMyPly(ply) {
    return myColor === 'white' ? ply % 2 === 1 : ply % 2 === 0;
  }

  function loadPgn(pgn) {
    positions = [];
    classifications = [];
    currentPly = 0;
    container.innerHTML = '';
    if (!pgn) return;

    const games = parsePgn(pgn);
    if (!games?.length) return;
    const game = games[0];
    const posResult = startingPosition(game.headers);
    if (posResult.isErr) return;

    const pos = posResult.value;
    positions.push({ fen: makeFen(pos.toSetup()), san: null, uci: null });

    for (const node of game.moves.mainline()) {
      const san = node.san;
      if (!san) break;
      const move = parseSan(pos, san);
      if (!move) break;
      const uci = makeUci(move);
      pos.play(move);
      positions.push({ fen: makeFen(pos.toSetup()), san, uci });
    }

    render();
    goToMove(positions.length - 1);
  }

  function setPlayerColor(color) {
    myColor = color;
    if (classifications.length) render(); // re-render with updated coloring
    if (currentPly > 0) highlightPly(currentPly);
  }

  function setClassifications(classResults) {
    classifications = classResults || [];
    render();
    if (currentPly > 0) highlightPly(currentPly);
  }

  function render() {
    container.innerHTML = '';

    for (let ply = 1; ply < positions.length; ply++) {
      const { san } = positions[ply];
      const isWhite = ply % 2 === 1;
      const cls = classifications[ply];
      const mine = isMyPly(ply);

      // Move number
      if (isWhite) {
        const numSpan = document.createElement('span');
        numSpan.className = 'move-number';
        numSpan.textContent = `${Math.ceil(ply / 2)}.`;
        container.appendChild(numSpan);
      }

      const moveSpan = document.createElement('span');
      moveSpan.className = 'move';
      moveSpan.dataset.ply = ply;

      // Only color MY moves with classification; opponent moves stay neutral
      if (cls && mine) {
        moveSpan.classList.add(`move-${cls.classification}`);
      }

      // Glyph shown for ALL moves (both players)
      let displayText = san;
      if (cls?.glyph) displayText += cls.glyph;
      moveSpan.textContent = displayText;

      if (cls) {
        const evalStr = (cls.evalAfter / 100).toFixed(1);
        const epStr = cls.epLoss !== undefined ? cls.epLoss.toFixed(3) : '?';
        moveSpan.title = `${cls.classification} (EP loss: ${epStr}) | eval: ${evalStr}`;
      }

      moveSpan.addEventListener('click', () => goToMove(ply));
      container.appendChild(moveSpan);
    }
  }

  function highlightPly(ply) {
    for (const m of container.querySelectorAll('.move')) {
      m.classList.toggle('active', parseInt(m.dataset.ply) === ply);
    }
  }

  function setHoverPly(ply) {
    for (const m of container.querySelectorAll('.move')) {
      m.classList.toggle('chart-hover', parseInt(m.dataset.ply) === ply);
    }
  }

  function goToMove(ply) {
    if (ply < 0 || ply >= positions.length) return;
    currentPly = ply;
    highlightPly(ply);
    const activeEl = container.querySelector('.move.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onMoveSelect(ply, positions[ply].fen, classifications[ply] || null);
  }

  function goForward() { goToMove(currentPly + 1); }
  function goBack() { goToMove(currentPly - 1); }
  function goToStart() { goToMove(0); }
  function goToEnd() { goToMove(positions.length - 1); }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    else if (e.key === 'Home') { e.preventDefault(); goToStart(); }
    else if (e.key === 'End') { e.preventDefault(); goToEnd(); }
  });

  return {
    loadPgn, setClassifications, setPlayerColor, setHoverPly,
    goToMove, goForward, goBack, goToStart, goToEnd,
    getCurrentPly: () => currentPly,
    getPosition: (ply) => positions[ply] || null,
    getClassification: (ply) => classifications[ply] || null,
    getTotalPlies: () => positions.length - 1,
    getAllPositions: () => positions,
  };
}
