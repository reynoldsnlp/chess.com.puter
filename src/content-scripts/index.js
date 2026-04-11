// chess.com.puter content script entry point.
// Detects chess platform, extracts PGN from completed games, and communicates with the service worker.
// NEVER sends live game positions to the engine - anti-cheating by design.

import { MSG } from '../shared/messages.js';
import { isGameComplete, isChessComGameOver } from '../shared/gameStatus.js';
import { detectPlatform, PLATFORM } from './platformDetector.js';
import { observeNavigation } from './observers/navigationObserver.js';
import { extractChessComPgn, getChessComMetadata, startClockObserver } from './extractors/chesscom.js';
import { extractLichessPgn, isLichessGameOver, getLichessMetadata } from './extractors/lichess.js';
import { extractGenericPgn } from './extractors/generic.js';

let currentExtractor = null;
let cleanupNavigation = null;
let cleanupClock = null;
let runtimeAvailable = true;

function isExtensionContextInvalidated(error) {
  const message = error?.message || String(error || '');
  return /Extension context invalidated/i.test(message);
}

function shutdownRuntime(error) {
  if (!runtimeAvailable) return;
  runtimeAvailable = false;
  cleanup();
  console.warn('chess.com.puter: content script runtime invalidated; shutting down stale observers', error);
}

async function safeSendMessage(message) {
  if (!runtimeAvailable) return false;
  try {
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      shutdownRuntime(error);
      return false;
    }
    console.debug('chess.com.puter: runtime sendMessage failed', error);
    return false;
  }
}

function installRuntimeListener(listener) {
  if (!runtimeAvailable) return;
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!runtimeAvailable) return false;
      try {
        return listener(message, sender, sendResponse);
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          shutdownRuntime(error);
          return false;
        }
        throw error;
      }
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      shutdownRuntime(error);
      return;
    }
    throw error;
  }
}

function init() {
  if (!runtimeAvailable) return;
  const detection = detectPlatform();
  if (!detection) return;

  // Run extraction for the current page
  handlePage(detection);

  // Watch for SPA navigation (chess.com is a React SPA)
  cleanupNavigation = observeNavigation(() => {
    if (!runtimeAvailable) return;
    cleanup();
    const newDetection = detectPlatform();
    if (newDetection) handlePage(newDetection);
  });
}

async function handlePage(detection) {
  if (!runtimeAvailable) return;
  const { platform } = detection;

  if (platform === PLATFORM.CHESSCOM) {
    await handleChessComPage();
  } else if (platform === PLATFORM.LICHESS) {
    await handleLichessPage();
  }
}

async function handleChessComPage() {
  // Wait briefly for the page to fully render (chess.com uses dynamic rendering)
  await delay(1500);
  if (!runtimeAvailable) return;

  // Check if the game is over using DOM signals
  const domGameOver = isChessComGameOver();

  // Try to extract PGN
  const pgn = await extractChessComPgn();

  const pgnGameOver = pgn ? isGameComplete(pgn) : false;

  const isGameOver = domGameOver || pgnGameOver;

  // Get player metadata
  const metadata = getChessComMetadata();

  // Send game detection message
  const sent = await safeSendMessage({
    type: MSG.GAME_DETECTED,
    payload: {
      pgn: isGameOver ? pgn : null, // Only send PGN for completed games
      isGameOver,
      metadata,
      platform: PLATFORM.CHESSCOM,
      url: window.location.href,
    },
  });
  if (!sent) return;

  // If game is live, start observing clocks for the live helper
  if (!isGameOver) {
    cleanupClock = startClockObserver((clockData) => {
      safeSendMessage({
        type: MSG.CLOCK_UPDATE,
        payload: clockData,
      });
    });

    // Also watch for the game to end, then re-extract
    watchForGameEnd();
  }
}

/**
 * Poll for game-over state during a live game.
 * When the game ends, re-extract PGN and send a new GAME_DETECTED message.
 */
function watchForGameEnd() {
  const interval = setInterval(async () => {
    if (!runtimeAvailable) {
      clearInterval(interval);
      return;
    }
    if (isChessComGameOver()) {
      clearInterval(interval);
      if (cleanupClock) {
        cleanupClock();
        cleanupClock = null;
      }

      // Wait for the post-game UI to settle
      await delay(2000);
      if (!runtimeAvailable) return;

      const pgn = await extractChessComPgn();
      const metadata = getChessComMetadata();

      await safeSendMessage({
        type: MSG.GAME_DETECTED,
        payload: {
          pgn,
          isGameOver: true,
          metadata,
          platform: PLATFORM.CHESSCOM,
          url: window.location.href,
        },
      });
    }
  }, 3000);

  // Store for cleanup
  currentExtractor = { cleanup: () => clearInterval(interval) };
}

function cleanup() {
  if (currentExtractor?.cleanup) currentExtractor.cleanup();
  if (cleanupClock) cleanupClock();
  currentExtractor = null;
  cleanupClock = null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleLichessPage() {
  await delay(1000);
  if (!runtimeAvailable) return;

  const domGameOver = isLichessGameOver();
  const pgn = await extractLichessPgn();
  const pgnGameOver = pgn ? isGameComplete(pgn) : false;
  const isGameOver = domGameOver || pgnGameOver;
  const metadata = getLichessMetadata();

  await safeSendMessage({
    type: MSG.GAME_DETECTED,
    payload: {
      pgn: isGameOver ? pgn : null,
      isGameOver,
      metadata,
      platform: PLATFORM.LICHESS,
      url: window.location.href,
    },
  });
}

// Listen for requests from the side panel (via service worker)
installRuntimeListener((message, sender, sendResponse) => {
  if (message.type === MSG.REQUEST_GAME || message.type === MSG.SCAN_PAGE) {
    const detection = detectPlatform();
    if (detection?.platform === PLATFORM.CHESSCOM) handleChessComPage();
    else if (detection?.platform === PLATFORM.LICHESS) handleLichessPage();
  }
});

// Initialize
init();
