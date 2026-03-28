// Chess.com DOM-based PGN extraction.
// All strategies are DOM-only - no API calls.

/**
 * Extract PGN from a chess.com game page.
 * Tries multiple strategies in order of reliability.
 * @returns {Promise<string|null>}
 */
export async function extractChessComPgn() {
  // Strategy A: Share dialog PGN textarea
  const sharePgn = await tryShareDialog();
  if (sharePgn) return sharePgn;

  // Strategy B: DOM move list scraping
  const scrapedPgn = tryMoveListScrape();
  if (scrapedPgn) return scrapedPgn;

  // Strategy C: Embedded script data
  const scriptPgn = tryScriptData();
  if (scriptPgn) return scriptPgn;

  return null;
}

// --- Strategy A: Share Dialog ---

async function tryShareDialog() {
  // Find the share button
  const shareBtn = findElement([
    'button [data-glyph="graph-nodes-share"]',
    '[aria-label="Share"]',
    '.share-game-button',
  ]);

  if (!shareBtn) return null;

  // Click the button (or its parent if we matched a child element)
  const clickTarget = shareBtn.closest('button') || shareBtn;
  clickTarget.click();

  // Wait for the share modal to appear
  const modal = await waitForElement([
    '.share-menu-tab-pgn-textarea',
    'textarea[aria-label*="PGN"]',
    '.share-menu-component textarea',
  ], 3000);

  if (!modal) {
    // Close any modal that might have opened
    closeModal();
    return null;
  }

  // If there's a PGN tab, click it first
  const pgnTab = document.querySelector('#tab-pgn') || findElementByText('button', 'PGN');
  if (pgnTab) {
    pgnTab.click();
    await delay(300);
  }

  // Read PGN from textarea
  const textarea = findElement([
    '.share-menu-tab-pgn-textarea',
    'textarea[aria-label*="PGN"]',
    '.share-menu-component textarea',
  ]);

  const pgn = textarea?.value?.trim() || null;

  // Close the modal
  closeModal();

  return pgn;
}

// --- Strategy B: Move List Scraping ---

function tryMoveListScrape() {
  const moveListContainer = findElement([
    '.move-list-component',
    '[data-testid="move-list"]',
    '.play-controller-moves',
    '.game-review-moves',
  ]);

  if (!moveListContainer) return null;

  // Extract individual moves
  const moves = [];
  const moveElements = moveListContainer.querySelectorAll('[data-ply], .move-text, .node .move');

  if (moveElements.length === 0) {
    // Heuristic: find elements that look like chess moves
    const allElements = moveListContainer.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (text && isChessMove(text) && el.children.length === 0) {
        moves.push(text);
      }
    }
  } else {
    for (const el of moveElements) {
      const text = el.textContent?.trim();
      if (text && isChessMove(text)) {
        moves.push(text);
      }
    }
  }

  if (moves.length === 0) return null;

  // Assemble PGN movetext
  let pgn = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) {
      pgn += `${Math.floor(i / 2) + 1}. `;
    }
    pgn += moves[i] + ' ';
  }

  // Try to find the result
  const result = findGameResult();
  if (result) pgn += result;

  return pgn.trim() || null;
}

// --- Strategy C: Script Data ---

function tryScriptData() {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent || '';
    // Look for PGN embedded in JSON data
    const pgnMatch = text.match(/"pgn"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (pgnMatch) {
      try {
        return JSON.parse(`"${pgnMatch[1]}"`);
      } catch (e) {
        // JSON parse failed, try raw
        return pgnMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }
  }
  return null;
}

// --- Metadata ---

/**
 * Extract player names and ratings from the chess.com page.
 * @returns {{ white: {name, rating}, black: {name, rating}, timeControl, url }}
 */
export function getChessComMetadata() {
  const metadata = {
    white: { name: 'White', rating: null },
    black: { name: 'Black', rating: null },
    timeControl: null,
    url: window.location.href,
  };

  // Try to find player name elements
  const playerEls = document.querySelectorAll('.player-component, [data-cy="player-info"]');
  if (playerEls.length >= 2) {
    // Top player is typically opponent (black if we're white)
    // But this varies; just grab what we can
    for (const el of playerEls) {
      const nameEl = el.querySelector('.user-username-component, .username, a[data-username]');
      const ratingEl = el.querySelector('.user-rating, .rating');
      const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('data-username');
      const rating = ratingEl?.textContent?.replace(/[()]/g, '').trim();

      if (name) {
        // Determine color by position in DOM (bottom = player's color)
        const isBottom = el.closest('.board-layout-bottom, .player-bottom') !== null;
        if (isBottom) {
          metadata.white.name = name;
          if (rating) metadata.white.rating = rating;
        } else {
          metadata.black.name = name;
          if (rating) metadata.black.rating = rating;
        }
      }
    }
  }

  return metadata;
}

// --- Clock Observer ---

/**
 * Start observing chess.com clocks for the live helper.
 * Only reads displayed time values - no board positions or moves.
 * @param {(data: {whiteTime: string, blackTime: string, playerColor: string}) => void} callback
 * @returns {() => void} cleanup function
 */
export function startClockObserver(callback) {
  const interval = setInterval(() => {
    const clocks = document.querySelectorAll('.clock-component, .clock-time-monospace, [data-cy="clock"]');
    if (clocks.length >= 2) {
      // Bottom clock is the player's clock
      const times = Array.from(clocks).map((c) => c.textContent?.trim() || '?');
      callback({
        whiteTime: times[1] || '?', // Bottom clock (usually player)
        blackTime: times[0] || '?', // Top clock (usually opponent)
        playerColor: 'white', // Approximate; could be refined
      });
    }
  }, 1000);

  return () => clearInterval(interval);
}

// --- Helpers ---

function findElement(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function findElementByText(tag, text) {
  const elements = document.querySelectorAll(tag);
  for (const el of elements) {
    if (el.textContent?.trim().toLowerCase() === text.toLowerCase()) return el;
  }
  return null;
}

function waitForElement(selectors, timeout) {
  return new Promise((resolve) => {
    const el = findElement(selectors);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = findElement(selectors);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function closeModal() {
  const closeBtn = findElement([
    '.cc-modal-header-close',
    '.ui_outside-close-icon',
    '[aria-label="Close"]',
    '.icon-font-chess.x',
  ]);
  if (closeBtn) closeBtn.click();
}

const CHESS_MOVE_REGEX = /^[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?[+#]?$|^O-O(?:-O)?[+#]?$/;

function isChessMove(text) {
  return CHESS_MOVE_REGEX.test(text);
}

function findGameResult() {
  // Look for result text on the page
  const resultPatterns = ['1-0', '0-1', '1/2-1/2', '½-½'];
  const resultEls = document.querySelectorAll('.game-result, .result, [data-result]');
  for (const el of resultEls) {
    const text = el.textContent?.trim();
    if (text && resultPatterns.some((p) => text.includes(p))) {
      if (text.includes('1-0')) return '1-0';
      if (text.includes('0-1')) return '0-1';
      if (text.includes('1/2') || text.includes('½')) return '1/2-1/2';
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
