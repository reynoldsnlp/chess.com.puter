// Vanilla JS move list component.
// Supports main line display, classification colors, and hypothetical variation lines.

import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan, makeSan } from 'chessops/san';
import { makeFen, parseFen } from 'chessops/fen';
import { makeUci, parseUci, parseSquare } from 'chessops/util';
import { Chess } from 'chessops/chess';
import { formatEvalScore } from '../evalUtils.js';

export function createMoveList(container, onMoveSelect) {
  let positions = [];       // main line: [{ fen, san, uci }] indexed by ply
  let classifications = [];
  let currentPly = 0;
  let myColor = 'white';

  // Hypothetical line state
  let hypo = null;  // null or { branchPly, moves: [{fen, san, uci}], currentIndex }
  let hypoBox = null; // DOM element for hypothetical display

  function isMyPly(ply) {
    return myColor === 'white' ? ply % 2 === 1 : ply % 2 === 0;
  }

  function loadPgn(pgn) {
    positions = []; classifications = []; currentPly = 0; closeHypothetical();
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
    goToMove(0);
  }

  function loadStartingPosition() {
    positions = []; classifications = []; currentPly = 0; closeHypothetical();
    container.innerHTML = '';
    const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    positions.push({ fen: STARTING_FEN, san: null, uci: null });
    goToMove(0);
  }

  function setPlayerColor(color) { myColor = color; if (classifications.length) render(); if (currentPly > 0) highlightPly(currentPly); }
  function setClassifications(classResults) { classifications = classResults || []; render(); if (currentPly > 0) highlightPly(currentPly); }

  function shouldColorizeMove(cls, mine) {
    return Boolean(cls) && (mine || cls.classification === 'book');
  }

  function updateClassification(ply, cls) {
    while (classifications.length <= ply) classifications.push(null);
    classifications[ply] = cls;
    const moveSpan = container.querySelector(`.move[data-ply="${ply}"]`);
    if (!moveSpan) return;
    const mine = isMyPly(ply);
    for (const c of ['best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder']) {
      moveSpan.classList.remove(`move-${c}`);
    }
    if (shouldColorizeMove(cls, mine)) moveSpan.classList.add(`move-${cls.classification}`);
    let displayText = positions[ply]?.san || '';
    if (cls?.glyph) displayText += cls.glyph;
    moveSpan.textContent = displayText;
    if (cls) {
      moveSpan.title = classificationTitle(cls);
    }
  }

  function render() {
    container.innerHTML = '';
    hypoBox = null;

    for (let ply = 1; ply < positions.length; ply++) {
      const { san } = positions[ply];
      const isWhite = ply % 2 === 1;
      const cls = classifications[ply];
      const mine = isMyPly(ply);

      if (isWhite) {
        const numSpan = document.createElement('span');
        numSpan.className = 'move-number';
        numSpan.textContent = `${Math.ceil(ply / 2)}.`;
        container.appendChild(numSpan);
      }

      const moveSpan = document.createElement('span');
      moveSpan.className = 'move';
      moveSpan.dataset.ply = ply;
      if (shouldColorizeMove(cls, mine)) moveSpan.classList.add(`move-${cls.classification}`);
      let displayText = san;
      if (cls?.glyph) displayText += cls.glyph;
      moveSpan.textContent = displayText;
      if (cls) {
        moveSpan.title = classificationTitle(cls);
      }
      moveSpan.addEventListener('click', () => { closeHypothetical(); goToMove(ply); });
      container.appendChild(moveSpan);
    }
  }

  let hypoElements = []; // track inserted hypo DOM elements for cleanup

  function renderHypothetical() {
    if (!hypo) return;
    removeHypoElements();

    // Find the main-line move span at branchPly to insert after
    let insertAfter = null;
    for (const m of container.querySelectorAll('.move')) {
      if (parseInt(m.dataset.ply) === hypo.branchPly) { insertAfter = m; break; }
    }
    // If branchPly is 0 (before any move), insert at the start
    const insertBefore = insertAfter ? insertAfter.nextSibling : container.firstChild;

    for (let i = 0; i < hypo.moves.length; i++) {
      const m = hypo.moves[i];
      const totalPly = hypo.branchPly + 1 + i;
      const isWhite = totalPly % 2 === 1;
      const isFirst = i === 0;
      const isLast = i === hypo.moves.length - 1;
      const needsNumber = isWhite || isFirst;

      // Move number (at start, or at each white move)
      if (needsNumber) {
        const numSpan = document.createElement('span');
        numSpan.className = 'move-number hypo-number';
        if (isFirst) numSpan.classList.add('hypo-first');
        const moveNum = Math.ceil(totalPly / 2);
        // Include trailing space inside the span so borders are continuous
        numSpan.textContent = (isWhite ? `${moveNum}.\u00A0` : `${moveNum}\u2026\u00A0`);
        container.insertBefore(numSpan, insertBefore);
        hypoElements.push(numSpan);
      }

      const moveSpan = document.createElement('span');
      moveSpan.className = 'move hypo-move';
      // If first hypo element is a black move (no number), it needs the left border
      if (isFirst && !needsNumber) moveSpan.classList.add('hypo-first');
      if (isLast) moveSpan.classList.add('hypo-last');
      if (i === hypo.currentIndex) moveSpan.classList.add('active');
      // Include trailing space inside non-last spans for continuous borders
      moveSpan.textContent = isLast ? m.san : m.san + '\u00A0';
      moveSpan.dataset.hypoIndex = i;
      moveSpan.addEventListener('click', () => navigateHypothetical(i));
      container.insertBefore(moveSpan, insertBefore);
      hypoElements.push(moveSpan);
    }

    // Scroll the last hypo element into view
    const lastEl = hypoElements[hypoElements.length - 1];
    if (lastEl) lastEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function removeHypoElements() {
    for (const el of hypoElements) el.remove();
    hypoElements = [];
  }

  function highlightPly(ply) {
    for (const m of container.querySelectorAll('.move:not(.hypo-move)')) {
      const p = m.dataset.ply;
      if (p !== undefined) m.classList.toggle('active', parseInt(p) === ply && !hypo);
    }
  }

  function highlightHypoIndex(index) {
    for (const m of container.querySelectorAll('.hypo-move')) {
      m.classList.toggle('active', parseInt(m.dataset.hypoIndex) === index);
    }
  }

  function setHoverPly(ply) {
    for (const m of container.querySelectorAll('.move')) {
      const p = m.dataset.ply;
      if (p !== undefined) m.classList.toggle('chart-hover', parseInt(p) === ply);
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

  function goForward() {
    if (hypo) {
      if (hypo.currentIndex < hypo.moves.length - 1) {
        navigateHypothetical(hypo.currentIndex + 1);
      }
      // At end of hypothetical: do nothing (disabled)
      return;
    }
    goToMove(currentPly + 1);
  }

  function goBack() {
    if (hypo) {
      if (hypo.currentIndex > 0) {
        navigateHypothetical(hypo.currentIndex - 1);
      } else {
        // Back past start of hypothetical: close it, go to branch point
        closeHypothetical();
        goToMove(currentPly); // currentPly is still the branchPly
      }
      return;
    }
    goToMove(currentPly - 1);
  }

  function goToStart() { closeHypothetical(); goToMove(0); }
  function goToEnd() { closeHypothetical(); goToMove(positions.length - 1); }

  // --- Hypothetical line management ---

  function closeHypothetical() {
    hypo = null;
    removeHypoElements();
    highlightPly(currentPly);
  }

  function startHypothetical(branchPly, firstMove) {
    closeHypothetical();
    hypo = { branchPly, moves: [firstMove], currentIndex: 0 };
    currentPly = branchPly;
    highlightPly(branchPly); // dim main line highlight
    renderHypothetical();
  }

  function addHypotheticalMove(move) {
    if (!hypo) return;
    // Truncate any moves after current index
    hypo.moves.length = hypo.currentIndex + 1;
    hypo.moves.push(move);
    hypo.currentIndex = hypo.moves.length - 1;
    renderHypothetical();
  }

  function navigateHypothetical(index) {
    if (!hypo || index < 0 || index >= hypo.moves.length) return;
    hypo.currentIndex = index;
    highlightHypoIndex(index);
    const m = hypo.moves[index];
    // ply=-1 signals hypothetical; pass uci as 4th arg for board highlighting
    onMoveSelect(-1, m.fen, null, m.uci);
  }

  /**
   * Handle a user move on the board.
   * @param {string} uci - the UCI move (e.g., 'e2e4')
   * @param {string} fen - the resulting FEN after the move
   * @param {string} san - the SAN notation
   * @returns {'advanced' | 'hypothetical' | 'extended'} what happened
   */
  function handleUserMove(uci, fen, san) {
    if (hypo) {
      // In a hypothetical: check if move matches next hypo move
      const nextIndex = hypo.currentIndex + 1;
      if (nextIndex < hypo.moves.length && hypo.moves[nextIndex].uci === uci) {
        navigateHypothetical(nextIndex);
        return 'advanced';
      }
      // Diverges or extends: truncate and add
      addHypotheticalMove({ fen, san, uci });
      navigateHypothetical(hypo.currentIndex);
      return 'extended';
    }

    // In main line: check if move matches next game move
    const nextPly = currentPly + 1;
    if (nextPly < positions.length && positions[nextPly].uci === uci) {
      goToMove(nextPly);
      return 'advanced';
    }

    // Diverges: start hypothetical
    startHypothetical(currentPly, { fen, san, uci });
    navigateHypothetical(0);
    return 'hypothetical';
  }

  function isInHypothetical() { return hypo !== null; }
  function canGoForward() {
    if (hypo) return hypo.currentIndex < hypo.moves.length - 1;
    return currentPly < positions.length - 1;
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    else if (e.key === 'Home') { e.preventDefault(); goToStart(); }
    else if (e.key === 'End') { e.preventDefault(); goToEnd(); }
  });

  return {
    loadPgn, loadStartingPosition, setClassifications, updateClassification, setPlayerColor, setHoverPly,
    goToMove, goForward, goBack, goToStart, goToEnd,
    handleUserMove, closeHypothetical, isInHypothetical, canGoForward,
    startHypothetical, addHypotheticalMove, navigateHypothetical,
    getHypoLength: () => hypo ? hypo.moves.length : 0,
    getCurrentPly: () => currentPly,
    getPosition: (ply) => positions[ply] || null,
    getClassification: (ply) => classifications[ply] || null,
    getTotalPlies: () => positions.length - 1,
    getAllPositions: () => positions,
    getCurrentPathPositions() {
      const path = positions.slice(0, currentPly + 1);
      if (hypo) path.push(...hypo.moves.slice(0, hypo.currentIndex + 1));
      return path;
    },
    /** Get the current FEN (main line or hypothetical) */
    getCurrentFen() {
      if (hypo) return hypo.moves[hypo.currentIndex]?.fen;
      return positions[currentPly]?.fen;
    },
  };
}

function classificationTitle(cls) {
  const evalStr = formatEvalScore(cls.evalAfterScore || { type: 'cp', value: cls.evalAfter }, { showPlus: false });
  const epStr = cls.epLoss !== undefined ? cls.epLoss.toFixed(3) : '?';
  const openingStr = cls.opening?.name ? ` | opening: ${cls.opening.name}` : '';
  return `${cls.classification} (EP loss: ${epStr}) | eval: ${evalStr}${openingStr}`;
}
