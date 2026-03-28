// Vanilla JS move list component.
// Renders PGN moves as clickable spans with keyboard navigation.

import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';

/**
 * Create a move list component.
 * @param {HTMLElement} container - the element to render into
 * @param {(ply: number, fen: string) => void} onMoveSelect - called when a move is clicked
 * @returns {object} move list controller
 */
export function createMoveList(container, onMoveSelect) {
  let positions = []; // Array of { fen, san } indexed by ply
  let currentPly = 0;

  /**
   * Load a PGN string and render the move list.
   * @param {string} pgn
   */
  function loadPgn(pgn) {
    positions = [];
    currentPly = 0;
    container.innerHTML = '';

    if (!pgn) return;

    // Parse PGN
    const games = parsePgn(pgn);
    if (!games || games.length === 0) return;

    const game = games[0];

    // Get starting position from PGN headers (handles FEN tag)
    const posResult = startingPosition(game.headers);
    if (posResult.isErr) return;

    const pos = posResult.value;

    // Starting position FEN
    positions.push({ fen: makeFen(pos.toSetup()), san: null });

    // Walk the main line using the mainline() iterator
    for (const node of game.moves.mainline()) {
      const san = node.san;
      if (!san) break;

      // Parse the SAN move
      const move = parseSan(pos, san);
      if (!move) break; // Illegal move

      // Play the move (mutates pos)
      pos.play(move);

      // Store the resulting position
      positions.push({ fen: makeFen(pos.toSetup()), san });
    }

    render();
    goToMove(positions.length - 1); // Start at the last move
  }

  function render() {
    container.innerHTML = '';

    for (let ply = 1; ply < positions.length; ply++) {
      const { san } = positions[ply];
      const isWhite = ply % 2 === 1;

      // Move number
      if (isWhite) {
        const numSpan = document.createElement('span');
        numSpan.className = 'move-number';
        numSpan.textContent = `${Math.ceil(ply / 2)}.`;
        container.appendChild(numSpan);
      }

      // Move text
      const moveSpan = document.createElement('span');
      moveSpan.className = 'move';
      moveSpan.textContent = san;
      moveSpan.dataset.ply = ply;
      moveSpan.addEventListener('click', () => goToMove(ply));
      container.appendChild(moveSpan);
    }
  }

  function goToMove(ply) {
    if (ply < 0 || ply >= positions.length) return;
    currentPly = ply;

    // Update highlighting
    const allMoves = container.querySelectorAll('.move');
    for (const m of allMoves) {
      m.classList.toggle('active', parseInt(m.dataset.ply) === ply);
    }

    // Auto-scroll to keep active move visible
    const activeEl = container.querySelector('.move.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Notify listener
    onMoveSelect(ply, positions[ply].fen);
  }

  function goForward() {
    goToMove(currentPly + 1);
  }

  function goBack() {
    goToMove(currentPly - 1);
  }

  function goToStart() {
    goToMove(0);
  }

  function goToEnd() {
    goToMove(positions.length - 1);
  }

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        goBack();
        break;
      case 'ArrowRight':
        e.preventDefault();
        goForward();
        break;
      case 'Home':
        e.preventDefault();
        goToStart();
        break;
      case 'End':
        e.preventDefault();
        goToEnd();
        break;
    }
  });

  return {
    loadPgn,
    goToMove,
    goForward,
    goBack,
    goToStart,
    goToEnd,
    getCurrentPly: () => currentPly,
    getPosition: (ply) => positions[ply] || null,
    getTotalPlies: () => positions.length - 1,
  };
}
