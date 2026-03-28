// Chessground board wrapper.
// View-only board for analysis - position set programmatically.

import { Chessground } from '@lichess-org/chessground';

export function createBoard(container) {
  const cg = Chessground(container, {
    movable: { free: false, color: undefined },
    draggable: { enabled: false },
    selectable: { enabled: false },
    coordinates: true,
    animation: { enabled: true, duration: 200 },
  });

  return {
    /** Set the board position from a FEN string */
    setPosition(fen) {
      const parts = fen.split(' ');
      cg.set({
        fen: parts[0],
        turnColor: parts[1] === 'b' ? 'black' : 'white',
        check: false,
      });
    },

    /** Highlight the last move (from/to squares) */
    setLastMove(from, to) {
      cg.set({ lastMove: from && to ? [from, to] : undefined });
    },

    /** Flip the board orientation */
    flip() {
      cg.toggleOrientation();
    },

    /** Set the board orientation */
    setOrientation(color) {
      cg.set({ orientation: color });
    },

    /** Get the chessground instance (for advanced use) */
    instance: cg,

    /** Clean up */
    destroy() {
      cg.destroy();
    },
  };
}
