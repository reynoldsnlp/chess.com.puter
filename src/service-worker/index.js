// chess.com.puter service worker.
// Routes messages between content scripts and the side panel.
// Enforces the game-over gate: PGN is stripped from messages for live games.

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';

// Cache the latest game data per tab
const tabGameData = new Map();
const LIVE_GAME_CACHE_MAX_AGE_MS = 15000;

// Open side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case MSG.GAME_DETECTED:
      handleGameDetected(message.payload, tabId);
      break;

    case MSG.REQUEST_GAME:
      handleRequestGame(sendResponse);
      return true; // Keep sendResponse alive for async response

    case MSG.OPEN_IN_LICHESS:
      if (message.payload?.url) {
        chrome.tabs.create({ url: message.payload.url });
      }
      break;

    case MSG.SCAN_PAGE:
      // Forward scan request to the active tab's content script
      handleScanPage();
      break;
  }
});

/**
 * Handle a GAME_DETECTED message from a content script.
 * Enforces the game-over gate before forwarding.
 */
function handleGameDetected(payload, tabId) {
  const { pgn, isGameOver, metadata, platform, url } = payload;

  // Defense in depth: never forward PGN unless the PGN itself is terminal.
  // A DOM-confirmed post-game page may briefly have no complete PGN yet; that
  // should unlock the live gate without exposing an in-progress movelist.
  const pgnConfirmsOver = pgn ? isGameComplete(pgn) : false;
  const confirmedOver = Boolean(isGameOver) || pgnConfirmsOver;
  const safePgn = confirmedOver && pgnConfirmsOver ? pgn : null;

  // Build the forwarded message
  const gameData = {
    mode: confirmedOver ? 'analysis' : 'live_helper',
    pgn: safePgn, // Strip PGN unless completion is PGN-confirmed
    isGameOver: confirmedOver,
    metadata: metadata || {},
    platform: platform || 'unknown',
    url: url || '',
    tabId: tabId || null,
    updatedAt: Date.now(),
  };

  // Cache for this tab
  if (tabId) {
    tabGameData.set(tabId, gameData);
  }

  // Forward to side panel
  forwardToSidePanel({ type: MSG.GAME_DATA, payload: gameData });
}

/**
 * Handle a REQUEST_GAME message from the side panel.
 * Prioritises live games from any tab over the active tab's cached data.
 */
async function handleRequestGame(sendResponse) {
  await refreshStaleLiveGames();

  // Check all cached tabs for a live game first
  for (const [tid, data] of tabGameData) {
    if (isFreshLiveGame(data)) {
      sendResponse({ type: MSG.GAME_DATA, payload: { ...data, tabId: tid } });
      return;
    }
  }

  // Fall back to the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const cached = tabId ? tabGameData.get(tabId) : null;

  sendResponse({
    type: MSG.GAME_DATA,
    payload: cached || { mode: 'idle', pgn: null, isGameOver: false, metadata: {}, platform: 'unknown', url: '' },
  });
}

function isFreshLiveGame(data) {
  return data?.mode === 'live_helper'
    && Date.now() - (data.updatedAt || 0) <= LIVE_GAME_CACHE_MAX_AGE_MS;
}

async function refreshStaleLiveGames() {
  for (const [tabId, data] of tabGameData) {
    if (data?.mode !== 'live_helper' || isFreshLiveGame(data)) continue;

    const state = await getLiveTabState(tabId, data.platform);
    if (state === 'post_game') {
      tabGameData.set(tabId, {
        ...data,
        mode: 'analysis',
        pgn: null,
        isGameOver: true,
        updatedAt: Date.now(),
      });
    } else if (state === 'gone') {
      tabGameData.delete(tabId);
    } else {
      data.updatedAt = Date.now();
    }
  }
}

async function getLiveTabState(tabId, platform) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return 'gone';

    if (platform === 'chesscom') {
      if (!isChessComUrl(tab.url)) return 'gone';
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: hasChessComPostGameDom,
      });
      return result?.result ? 'post_game' : 'active';
    }

    if (platform === 'lichess') {
      if (!isLichessUrl(tab.url)) return 'gone';
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: hasLichessPostGameDom,
      });
      return result?.result ? 'post_game' : 'active';
    }

    return 'active';
  } catch (_) {
    // Keep blocking if the tab exists but cannot be inspected right now.
    return 'active';
  }
}

function isChessComUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'chess.com' || hostname.endsWith('.chess.com');
  } catch (_) {
    return false;
  }
}

function isLichessUrl(url) {
  try {
    return new URL(url).hostname === 'lichess.org';
  } catch (_) {
    return false;
  }
}

function hasChessComPostGameDom() {
  const selectors = [
    '[data-cy="sidebar-game-over-new-game-button"]',
    '[data-cy="sidebar-game-over-rematch-button"]',
    '[data-cy="sidebar-game-review-button"]',
    '[data-cy="quick-analysis-tally-item"]',
    '.game-review-buttons-component',
    '.game-review-emphasis-component',
    '.new-game-buttons-component',
    '.quick-analysis-tally-component',
    '.game-over-modal',
    '.game-over-header-component',
    '.result-row .game-result',
    '.move-list-row.result-row',
  ];
  if (selectors.some((selector) => document.querySelector(selector))) return true;

  const resultRow = document.querySelector('.game-result, .result-row');
  const resultText = resultRow?.textContent?.trim() || '';
  return ['1-0', '0-1', '1/2-1/2'].some((result) => resultText.includes(result));
}

function hasLichessPostGameDom() {
  const status = document.querySelector('.status');
  if (status) {
    const text = status.textContent?.toLowerCase() || '';
    if (['checkmate', 'resign', 'draw', 'stalemate', 'timeout', 'aborted'].some((t) => text.includes(t))) {
      return true;
    }
  }

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
 * Forward a message to the side panel via runtime messaging.
 */
function forwardToSidePanel(message) {
  // The side panel listens on chrome.runtime.onMessage
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open - that's fine
  });
}

/**
 * Forward a SCAN_PAGE request to the active tab's content script.
 * If the content script is stale (extension was reloaded), re-inject it.
 */
async function handleScanPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.SCAN_PAGE });
    } catch (e) {
      // Content script not responding — likely stale after extension reload.
      // Re-inject it.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/index.js'],
        });
      } catch (injectErr) {
        // Can't inject (e.g., chrome:// page) — ignore
      }
    }
  } catch (e) {}
}

// Clean up tab cache when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabGameData.delete(tabId);
});

// ============================================================
// POLL ALL TABS FOR ACTIVE GAMES
// ============================================================

const ALL_TAB_POLL_MS = 5000;

/**
 * Send SCAN_PAGE to every tab matching the manifest's host_permissions
 * so the panel can discover live games that are not on the active tab.
 */
async function pollAllTabs() {
  try {
    const manifest = chrome.runtime.getManifest();
    const urls = (manifest.host_permissions || []).map((p) =>
      p.endsWith('*') ? p : p + '*'
    );
    if (!urls.length) return;

    const tabs = await chrome.tabs.query({ url: urls });

    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: MSG.SCAN_PAGE });
      } catch (_) {
        // Content script not responding — re-inject
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/index.js'],
          });
        } catch (__) {
          // Can't inject (restricted page) — ignore
        }
      }
    }
  } catch (_) {}
}

setInterval(pollAllTabs, ALL_TAB_POLL_MS);
