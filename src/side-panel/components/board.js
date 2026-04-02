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
    highlight: { lastMove: true, check: true },
    drawable: {
      enabled: false, // disable user drawing, we only use auto shapes
      visible: true,
      brushes: {
        green: { key: 'green', color: '#15781B', opacity: 0.4, lineWidth: 10 },
        red: { key: 'red', color: '#882020', opacity: 0.4, lineWidth: 10 },
        blue: { key: 'blue', color: '#003088', opacity: 0.4, lineWidth: 10 },
        yellow: { key: 'yellow', color: '#e6a000', opacity: 0.4, lineWidth: 10 },
      },
    },
  });

  return {
    setPosition(fen) {
      const parts = fen.split(' ');
      cg.set({
        fen: parts[0],
        turnColor: parts[1] === 'b' ? 'black' : 'white',
        check: false,
      });
    },

    setLastMove(from, to) {
      cg.set({ lastMove: from && to ? [from, to] : undefined });
    },

    flip() { cg.toggleOrientation(); },

    setOrientation(color) { cg.set({ orientation: color }); },

    setAutoShapes(shapes) { cg.setAutoShapes(shapes); },

    clearAutoShapes() { cg.setAutoShapes([]); },

    instance: cg,

    destroy() { cg.destroy(); },
  };
}
