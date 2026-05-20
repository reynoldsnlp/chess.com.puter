// Game completion detection logic.
// Used by content scripts, service worker, and side panel (defense in depth).
// Returns true ONLY if the game is definitively over.

const TERMINAL_RESULTS = ['1-0', '0-1', '1/2-1/2'];

/**
 * Check if a PGN string represents a completed game.
 * @param {string} pgn - PGN text (may include headers and movetext)
 * @returns {boolean}
 */
export function isGameComplete(pgn) {
  if (!pgn || typeof pgn !== 'string') return false;

  // Check PGN Result header tag
  const resultMatch = pgn.match(/\[Result\s+"([^"]+)"\]/);
  if (resultMatch && TERMINAL_RESULTS.includes(resultMatch[1])) {
    return true;
  }

  // Check for result at end of movetext
  const trimmed = pgn.trim();
  for (const result of TERMINAL_RESULTS) {
    if (trimmed.endsWith(result)) {
      return true;
    }
  }

  // Check for checkmate indicator in the last move
  const movetext = pgn.replace(/\[[^\]]*\]/g, '').trim();
  if (movetext.includes('#')) {
    const withoutComments = movetext.replace(/\{[^}]*\}/g, '');
    if (withoutComments.includes('#')) {
      return true;
    }
  }

  return false;
}

/**
 * Check chess.com DOM for game-over indicators.
 * Only call from content scripts running on chess.com pages.
 * @returns {boolean}
 */
export function isChessComGameOver() {
  // Strategy 1: data-cy attributes (most reliable - chess.com's test IDs)
  const dataCySelectors = [
    '[data-cy="sidebar-game-over-new-game-button"]',
    '[data-cy="sidebar-game-over-rematch-button"]',
    '[data-cy="sidebar-game-review-button"]',
    '[data-cy="quick-analysis-tally-item"]',
  ];
  for (const selector of dataCySelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Strategy 2: class-based selectors for post-game UI components
  const classSelectors = [
    '.game-review-buttons-component',
    '.game-review-emphasis-component',
    '.new-game-buttons-component',
    '.quick-analysis-tally-component',
    '.game-over-modal',
    '.game-over-header-component',
    '.result-row .game-result',
    '.move-list-row.result-row',
  ];
  for (const selector of classSelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Strategy 3: aria-label on rematch/new-game buttons
  const ariaSelectors = [
    '[aria-label="Rematch"]',
    '[aria-label="New Game"]',
  ];
  for (const selector of ariaSelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Strategy 4: URL is a game review/analysis page
  const pathname = window.location.pathname;
  if (/^\/analysis\/game\//.test(pathname)) {
    return true;
  }

  // Strategy 5: rendered move-list result row. This covers post-game pages that
  // stay on /game/live/{id} or /game/{id} after Chess.com's SPA transition.
  const resultRow = document.querySelector('.game-result, .result-row');
  const resultText = resultRow?.textContent?.trim() || '';
  if (TERMINAL_RESULTS.some((result) => resultText.includes(result))) {
    return true;
  }

  return false;
}
