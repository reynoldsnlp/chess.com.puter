// Manual PGN paste component.
// Always available as fallback when auto-extraction fails.

import { isGameComplete } from '../../shared/gameStatus.js';

/**
 * @param {HTMLElement} container
 * @param {(pgn: string) => void} onSubmit - called with PGN text when user clicks Analyze
 */
export function createPgnInput(container, onSubmit) {
  container.innerHTML = `
    <div class="pgn-input-section">
      <button class="pgn-input-toggle" id="pgn-toggle">Paste PGN</button>
      <div class="pgn-input-body" id="pgn-body" hidden>
        <textarea id="pgn-textarea" placeholder="Paste PGN here..." rows="6"></textarea>
        <div class="pgn-input-actions">
          <button class="ctrl-btn" id="pgn-analyze">Analyze</button>
          <span id="pgn-warning" class="pgn-warning" hidden></span>
        </div>
      </div>
    </div>
  `;

  const toggle = container.querySelector('#pgn-toggle');
  const body = container.querySelector('#pgn-body');
  const textarea = container.querySelector('#pgn-textarea');
  const analyzeBtn = container.querySelector('#pgn-analyze');
  const warning = container.querySelector('#pgn-warning');

  toggle.addEventListener('click', () => {
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    toggle.textContent = isHidden ? 'Hide PGN input' : 'Paste PGN';
    if (isHidden) textarea.focus();
  });

  analyzeBtn.addEventListener('click', () => {
    const pgn = textarea.value.trim();
    if (!pgn) {
      showWarning('Please paste a PGN first.');
      return;
    }

    if (!isGameComplete(pgn)) {
      showWarning('This game appears to be in progress. Engine analysis is only available for completed games.');
      return;
    }

    warning.hidden = true;
    onSubmit(pgn);
    body.hidden = true;
    toggle.textContent = 'Paste PGN';
  });

  function showWarning(text) {
    warning.textContent = text;
    warning.hidden = false;
  }

  return {
    show() {
      body.hidden = false;
      toggle.textContent = 'Hide PGN input';
      textarea.focus();
    },
    hide() {
      body.hidden = true;
      toggle.textContent = 'Paste PGN';
    },
    clear() {
      textarea.value = '';
      warning.hidden = true;
    },
  };
}
