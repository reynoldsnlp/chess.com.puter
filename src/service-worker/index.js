// chess.com.puter service worker.
// Routes messages between content scripts and the side panel.
// Enforces the game-over gate: PGN is stripped from messages for live games.

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';

// Cache the latest game data per tab
const tabGameData = new Map();

// Open side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case MSG.GAME_DETECTED:
      handleGameDetected(message.payload, tabId);
      break;

    case MSG.CLOCK_UPDATE:
      // Forward clock updates to side panel (live helper only)
      forwardToSidePanel({ type: MSG.CLOCK_UPDATE, payload: message.payload });
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

  // Defense in depth: verify game completion on the PGN even if content script says it's over
  const pgnConfirmsOver = pgn ? isGameComplete(pgn) : false;
  const confirmedOver = isGameOver && (pgnConfirmsOver || !pgn);

  // Build the forwarded message
  const gameData = {
    mode: confirmedOver ? 'analysis' : 'live_helper',
    pgn: confirmedOver ? pgn : null, // Strip PGN for live games
    isGameOver: confirmedOver,
    metadata: metadata || {},
    platform: platform || 'unknown',
    url: url || '',
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
 */
async function handleRequestGame(sendResponse) {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const cached = tabId ? tabGameData.get(tabId) : null;

  sendResponse({
    type: MSG.GAME_DATA,
    payload: cached || { mode: 'idle', pgn: null, isGameOver: false, metadata: {}, platform: 'unknown', url: '' },
  });
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
