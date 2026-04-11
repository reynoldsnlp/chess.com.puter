// Chess.com DOM-based PGN extraction.
// All strategies are DOM-only - no API calls.

/**
 * Extract PGN from a chess.com game page.
 * Tries multiple strategies in order of reliability.
 * @returns {Promise<string|null>}
 */
export async function extractChessComPgn() {
  // Strategy A: DOM move list scraping (most reliable for current chess.com)
  const scrapedPgn = tryMoveListScrape();
  if (scrapedPgn) {
    return scrapedPgn;
  }

  // Strategy B: Share dialog PGN textarea
  const sharePgn = await tryShareDialog();
  if (sharePgn) {
    return sharePgn;
  }

  // Strategy C: Embedded script data
  const scriptPgn = tryScriptData();
  if (scriptPgn) {
    return scriptPgn;
  }

  return null;
}

// --- Strategy A: Move List Scraping ---

function tryMoveListScrape() {
  // Chess.com uses <wc-simple-move-list> with data-cy="move-list"
  const moveListContainer = findElement([
    '[data-cy="move-list"]',
    'wc-simple-move-list',
    '.move-list',
  ]);

  if (!moveListContainer) {
    return null;
  }

  // Chess.com move elements have class "node" and are either "white-move" or "black-move"
  // Move text is inside <span class="node-highlight-content">
  // Figurine notation uses <span data-figurine="B"> instead of text "B"
  const nodeElements = moveListContainer.querySelectorAll('.node');

  if (nodeElements.length === 0) {
    return null;
  }

  const moves = [];
  for (const node of nodeElements) {
    const san = extractMoveText(node);
    if (san) moves.push(san);
  }

  if (moves.length === 0) {
    return null;
  }

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

/**
 * Extract SAN move text from a chess.com move node element.
 * Handles figurine notation where piece symbols are <span data-figurine="X">.
 */
function extractMoveText(node) {
  // The move text is typically inside .node-highlight-content
  const contentEl = node.querySelector('.node-highlight-content') || node;

  let san = '';
  for (const child of contentEl.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      san += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      // Check for figurine piece notation
      const figurine = child.getAttribute('data-figurine');
      if (figurine) {
        san += figurine; // "K", "Q", "R", "B", "N"
      } else {
        san += child.textContent || '';
      }
    }
  }

  san = san.trim();
  if (!san) return null;

  // Validate it looks like a chess move
  if (isChessMove(san)) return san;

  // Sometimes there's extra whitespace or annotations
  san = san.replace(/\s+/g, '');
  if (isChessMove(san)) return san;

  return null;
}

// --- Strategy B: Share Dialog ---

async function tryShareDialog() {
  // Find the share button
  const shareBtn = findElement([
    '[data-cy="sidebar-share-icon"]',
    'button [data-glyph="graph-nodes-share"]',
    '[aria-label="Share"]',
  ]);

  if (!shareBtn) return null;

  const clickTarget = shareBtn.closest('button') || shareBtn.closest('a') || shareBtn;
  clickTarget.click();

  // Wait for share modal
  const modal = await waitForElement([
    '.share-menu-tab-pgn-textarea',
    'textarea[aria-label*="PGN"]',
    '.share-menu-component textarea',
  ], 3000);

  if (!modal) {
    closeModal();
    return null;
  }

  // Click PGN tab if present
  const pgnTab = document.querySelector('#tab-pgn') || findElementByText('button', 'PGN');
  if (pgnTab) {
    pgnTab.click();
    await delay(300);
  }

  const textarea = findElement([
    '.share-menu-tab-pgn-textarea',
    'textarea[aria-label*="PGN"]',
    '.share-menu-component textarea',
  ]);

  const pgn = textarea?.value?.trim() || null;
  closeModal();
  return pgn;
}

// --- Strategy C: Script Data ---

function tryScriptData() {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent || '';
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

// --- Metadata ---

export function getChessComMetadata() {
  const metadata = {
    white: { name: 'White', rating: null },
    black: { name: 'Black', rating: null },
    playerColor: 'white', // which color the user is playing
    timeControl: null,
    url: window.location.href,
  };

  // On chess.com, the bottom player is always "me".
  // Detect which color is on bottom by checking the clock or board orientation.
  const bottomPlayer = document.querySelector('#board-layout-player-bottom');
  const topPlayer = document.querySelector('#board-layout-player-top');

  // Detect player color from clock classes (clock-white / clock-black on bottom)
  const bottomClock = document.querySelector('.clock-bottom');
  if (bottomClock) {
    if (bottomClock.classList.contains('clock-black')) {
      metadata.playerColor = 'black';
    } else if (bottomClock.classList.contains('clock-white')) {
      metadata.playerColor = 'white';
    }
  }

  // Alternatively, check the board element for flipped state
  const boardEl = document.querySelector('wc-chess-board, chess-board');
  if (boardEl) {
    // chess.com's board has a "flipped" attribute or class when playing black
    if (boardEl.hasAttribute('flipped') || boardEl.classList.contains('flipped')) {
      metadata.playerColor = 'black';
    }
  }

  // Extract player names - bottom is me, top is opponent
  const isBlack = metadata.playerColor === 'black';

  if (bottomPlayer) {
    const name = bottomPlayer.querySelector('[data-cy="user-tagline-username"], .cc-user-username-component');
    const rating = bottomPlayer.querySelector('[data-cy="user-tagline-rating"]');
    const key = isBlack ? 'black' : 'white';
    if (name) metadata[key].name = name.textContent?.trim();
    if (rating) metadata[key].rating = rating.textContent?.replace(/[()]/g, '').trim();
  }

  if (topPlayer) {
    const name = topPlayer.querySelector('[data-cy="user-tagline-username"], .cc-user-username-component');
    const rating = topPlayer.querySelector('[data-cy="user-tagline-rating"]');
    const key = isBlack ? 'white' : 'black';
    if (name) metadata[key].name = name.textContent?.trim();
    if (rating) metadata[key].rating = rating.textContent?.replace(/[()]/g, '').trim();
  }

  return metadata;
}

// --- Clock Observer ---

export function startClockObserver(callback) {
  const interval = setInterval(() => {
    const clocks = document.querySelectorAll('[data-cy="clock-time"]');
    if (clocks.length >= 2) {
      const times = Array.from(clocks).map((c) => c.textContent?.trim() || '?');
      callback({
        whiteTime: times[1] || '?',
        blackTime: times[0] || '?',
        playerColor: 'white',
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
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

function closeModal() {
  const closeBtn = findElement([
    '.cc-modal-header-close',
    '.ui_outside-close-icon',
    '[aria-label="Close"]',
  ]);
  if (closeBtn) closeBtn.click();
}

const CHESS_MOVE_REGEX = /^[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?[+#]?$|^O-O(?:-O)?[+#]?$/;

function isChessMove(text) {
  return CHESS_MOVE_REGEX.test(text);
}

function findGameResult() {
  const resultPatterns = ['1-0', '0-1', '1/2-1/2', '½-½'];
  // Check data-cy result elements and general result classes
  const resultEls = document.querySelectorAll('.game-result, .result, [data-result], [data-cy*="result"]');
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
