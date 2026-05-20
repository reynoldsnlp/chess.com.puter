// Captured material rail shown beside the board.

import { parseFen } from 'chessops/fen';
import { Material } from 'chessops/setup';

const ROLES = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
const STARTING_MATERIAL = { queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8 };
const PIECE_VALUES = { queen: 9, rook: 5, bishop: 3, knight: 3, pawn: 1 };
const UNICODE_PIECES = {
  white: { queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
};

export function createMaterialPanel(container) {
  let orientation = 'white';
  let lastFen = null;
  let useChessgroundPieces = null;

  container.innerHTML = `
    <div class="material-side material-top" data-material-slot="top"></div>
    <div class="material-side material-bottom" data-material-slot="bottom"></div>
  `;

  const topSlot = container.querySelector('[data-material-slot="top"]');
  const bottomSlot = container.querySelector('[data-material-slot="bottom"]');

  function render() {
    const state = lastFen ? materialState(lastFen) : null;
    const topColor = orientation === 'white' ? 'black' : 'white';
    const bottomColor = orientation === 'white' ? 'white' : 'black';

    renderSide(topSlot, topColor, state);
    renderSide(bottomSlot, bottomColor, state);
  }

  function renderSide(slot, playerSide, state) {
    if (!slot) return;
    slot.innerHTML = '';
    slot.dataset.playerSide = playerSide;

    if (!state) return;

    const capturedColor = opposite(playerSide);
    const captured = state.capturedBy[playerSide];
    const score = playerSide === 'white' ? state.materialDiff : -state.materialDiff;

    const capturesEl = document.createElement('div');
    capturesEl.className = 'material-captures';

    for (const role of ROLES) {
      const count = captured[role] || 0;
      if (count <= 0) continue;
      capturesEl.appendChild(createPieceGroup(capturedColor, role, count, playerSide));
    }

    const advantageEl = document.createElement('div');
    advantageEl.className = 'material-advantage';
    if (score > 0) {
      advantageEl.textContent = `+${score}`;
      advantageEl.title = `${capitalize(playerSide)} is up ${score} material point${score === 1 ? '' : 's'}`;
    }

    slot.append(capturesEl, advantageEl);
  }

  function createPieceGroup(color, role, count, playerSide) {
    const group = document.createElement('div');
    group.className = 'material-piece-group';
    group.title = `${capitalize(playerSide)} captured ${count} ${color} ${role}${count === 1 ? '' : 's'}`;
    group.setAttribute('aria-label', group.title);

    group.appendChild(createPieceIcon(color, role));

    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'material-piece-count';
      badge.textContent = String(count);
      group.appendChild(badge);
    }

    return group;
  }

  function createPieceIcon(color, role) {
    if (useChessgroundPieces === null) useChessgroundPieces = hasChessgroundPieceImages();

    if (useChessgroundPieces) {
      const wrapper = document.createElement('span');
      wrapper.className = 'material-piece-icon material-piece-image cg-wrap';

      const piece = document.createElement('piece');
      piece.className = `${role} ${color}`;
      piece.setAttribute('aria-hidden', 'true');
      wrapper.appendChild(piece);
      return wrapper;
    }

    const icon = document.createElement('span');
    icon.className = `material-piece-icon material-piece-unicode material-piece-${color}`;
    icon.textContent = UNICODE_PIECES[color][role];
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  return {
    update(fen) {
      lastFen = fen || null;
      render();
    },
    reset() {
      lastFen = null;
      render();
    },
    setOrientation(color) {
      orientation = color === 'black' ? 'black' : 'white';
      render();
    },
  };
}

function materialState(fen) {
  const setup = parseFen(fen);
  if (setup.isErr) return null;

  const material = Material.fromBoard(setup.value.board);
  const whiteMaterial = materialSideValue(material.white);
  const blackMaterial = materialSideValue(material.black);

  return {
    materialDiff: whiteMaterial - blackMaterial,
    capturedBy: {
      white: missingMaterial(material.black),
      black: missingMaterial(material.white),
    },
  };
}

function materialSideValue(side) {
  let total = 0;
  for (const role of ROLES) total += side[role] * PIECE_VALUES[role];
  return total;
}

function missingMaterial(side) {
  const missing = {};
  for (const role of ROLES) missing[role] = Math.max(0, STARTING_MATERIAL[role] - side[role]);
  return missing;
}

function hasChessgroundPieceImages() {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      continue;
    }

    for (const rule of rules) {
      if (!rule.selectorText || !rule.style) continue;
      if (
        rule.selectorText.includes('piece.pawn.white')
        && rule.style.backgroundImage
        && rule.style.backgroundImage !== 'none'
      ) {
        return true;
      }
    }
  }

  return false;
}

function opposite(color) {
  return color === 'white' ? 'black' : 'white';
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
