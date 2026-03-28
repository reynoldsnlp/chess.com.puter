// Lichess DOM-based PGN extraction.
// All strategies are DOM-only - no API calls.

/**
 * Extract PGN from a Lichess game page.
 * @returns {Promise<string|null>}
 */
export async function extractLichessPgn() {
  // Strategy A: Embedded page data (Lichess SSR includes game JSON in script tags)
  const scriptPgn = tryEmbeddedData();
  if (scriptPgn) return scriptPgn;

  // Strategy B: DOM scraping of the move list
  const domPgn = tryMoveListScrape();
  if (domPgn) return domPgn;

  // Strategy C: FEN/PGN tab content
  const tabPgn = tryPgnTab();
  if (tabPgn) return tabPgn;

  return null;
}

// --- Strategy A: Embedded Data ---

function tryEmbeddedData() {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent || '';

    // Lichess embeds game data as JSON in PageModule calls
    // Look for PGN in various formats
    const pgnMatch = text.match(/"pgn"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (pgnMatch) {
      try {
        return JSON.parse(`"${pgnMatch[1]}"`);
      } catch (e) {
        return pgnMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }
  }
  return null;
}

// --- Strategy B: Move List Scraping ---

function tryMoveListScrape() {
  // Lichess analysis view
  const moveContainer = document.querySelector('.analyse__moves') ||
    document.querySelector('.tview2') ||
    document.querySelector('.rmoves');

  if (!moveContainer) return null;

  const moves = [];
  const moveEls = moveContainer.querySelectorAll('move, kwdb');

  for (const el of moveEls) {
    const text = el.textContent?.trim();
    if (text && /^[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|^O-O/.test(text)) {
      moves.push(text);
    }
  }

  if (moves.length === 0) return null;

  let pgn = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
    pgn += moves[i] + ' ';
  }

  return pgn.trim() || null;
}

// --- Strategy C: PGN Tab ---

function tryPgnTab() {
  // Lichess analysis board has a "FEN & PGN" tab
  const pgnTextarea = document.querySelector('.analyse__underboard textarea');
  if (pgnTextarea?.value?.trim()) {
    return pgnTextarea.value.trim();
  }

  // Also check for copyable PGN text
  const pgnEl = document.querySelector('.pgn');
  if (pgnEl?.textContent?.trim()) {
    return pgnEl.textContent.trim();
  }

  return null;
}

/**
 * Check if a Lichess game is completed (DOM-based).
 * @returns {boolean}
 */
export function isLichessGameOver() {
  // Check for result badge
  const status = document.querySelector('.status');
  if (status) {
    const text = status.textContent?.toLowerCase() || '';
    if (['checkmate', 'resign', 'draw', 'stalemate', 'timeout', 'aborted'].some(t => text.includes(t))) {
      return true;
    }
  }

  // Check for "play again" or "analysis board" buttons
  const buttons = document.querySelectorAll('.game__control button, .follow-up a');
  for (const btn of buttons) {
    const text = btn.textContent?.toLowerCase() || '';
    if (text.includes('analysis') || text.includes('rematch') || text.includes('new opponent')) {
      return true;
    }
  }

  return false;
}

/**
 * Get Lichess game metadata.
 */
export function getLichessMetadata() {
  const metadata = {
    white: { name: 'White', rating: null },
    black: { name: 'Black', rating: null },
    url: window.location.href,
  };

  const players = document.querySelectorAll('.game__meta__players .player');
  for (const player of players) {
    const nameEl = player.querySelector('.user-link');
    const ratingEl = player.querySelector('rating');
    const color = player.classList.contains('color-icon') ?
      (player.querySelector('.color-icon.is.white') ? 'white' : 'black') :
      (player.closest('.top') ? 'black' : 'white');

    const name = nameEl?.textContent?.trim();
    const rating = ratingEl?.textContent?.trim();
    if (name) {
      metadata[color].name = name;
      if (rating) metadata[color].rating = rating;
    }
  }

  return metadata;
}
