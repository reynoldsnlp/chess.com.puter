// Chessground board wrapper.
// Supports interactive mode for exploring hypothetical lines.

import { Chessground } from '@lichess-org/chessground';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSquare } from 'chessops/util';

export function createBoard(container) {
  let moveCallback = null;
  let interactive = false;
  let lastFen = null;

  const cg = Chessground(container, {
    movable: { free: false, color: undefined, events: { after: onPieceMoved } },
    draggable: { enabled: false },
    selectable: { enabled: false },
    coordinates: true,
    animation: { enabled: true, duration: 150 },
    highlight: { lastMove: true, check: true },
    drawable: {
      enabled: false,
      visible: true,
      brushes: {
        green: { key: 'green', color: '#15781B', opacity: 0.4, lineWidth: 10 },
        red: { key: 'red', color: '#882020', opacity: 0.4, lineWidth: 10 },
        blue: { key: 'blue', color: '#003088', opacity: 0.4, lineWidth: 10 },
        yellow: { key: 'yellow', color: '#e6a000', opacity: 0.4, lineWidth: 10 },
      },
    },
  });

  function onPieceMoved(from, to) {
    if (moveCallback) moveCallback(from, to);
  }

  function computeDests(fen) {
    const setup = parseFen(fen);
    if (setup.isErr) return new Map();
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return new Map();

    const dests = new Map();
    for (const [from, squares] of pos.value.allDests()) {
      const toKeys = [];
      for (const to of squares) toKeys.push(makeSquare(to));
      if (toKeys.length > 0) dests.set(makeSquare(from), toKeys);
    }

    // Convert castling destinations from king-captures-rook to standard 2-square king move
    const CASTLE_REMAP = { e1: { h1: 'g1', a1: 'c1' }, e8: { h8: 'g8', a8: 'c8' } };
    for (const [kingSquare, remaps] of Object.entries(CASTLE_REMAP)) {
      const kingDests = dests.get(kingSquare);
      if (!kingDests) continue;
      dests.set(kingSquare, kingDests.map(sq => remaps[sq] || sq));
    }

    return dests;
  }

  // Recalculate chessground dimensions on resize to fix click positioning
  const resizeObs = new ResizeObserver(() => cg.redrawAll());
  resizeObs.observe(container);

  return {
    /** Lightweight position update — avoids resetting selection state */
    setPosition(fen) {
      if (fen === lastFen) return;
      lastFen = fen;
      const parts = fen.split(' ');
      const turnColor = parts[1] === 'b' ? 'black' : 'white';

      if (interactive) {
        // Set fen + turn + dests in one call to avoid intermediate states
        cg.set({
          fen: parts[0],
          turnColor,
          check: false,
          movable: { color: turnColor, dests: computeDests(fen) },
        });
      } else {
        cg.set({ fen: parts[0], turnColor, check: false });
      }
    },

    /** Enable interactive mode (call once, not per move) */
    enableInteraction() {
      if (interactive) return;
      interactive = true;
      lastFen = null; // force dests recompute on next setPosition
      cg.set({ draggable: { enabled: true } });
    },

    /** Disable interactive mode */
    disableInteraction() {
      interactive = false;
      lastFen = null;
      cg.set({
        movable: { color: undefined, dests: new Map() },
        draggable: { enabled: false },
      });
    },

    onMove(fn) { moveCallback = fn; },

    setLastMove(from, to) {
      container.classList.remove('hypo-highlight');
      cg.set({ lastMove: from && to ? [from, to] : undefined });
    },

    /** Highlight hypothetical move squares (light blue) */
    setHypoLastMove(from, to) {
      container.classList.add('hypo-highlight');
      cg.set({ lastMove: from && to ? [from, to] : undefined });
    },

    /** Force chessground to recalculate dimensions (call after layout changes) */
    redraw() { cg.redrawAll(); },

    flip() { cg.toggleOrientation(); },
    setOrientation(color) { cg.set({ orientation: color }); },
    setAutoShapes(shapes) { cg.setAutoShapes(shapes); },
    clearAutoShapes() { cg.setAutoShapes([]); },
    instance: cg,
    destroy() { resizeObs.disconnect(); cg.destroy(); },
  };
}

