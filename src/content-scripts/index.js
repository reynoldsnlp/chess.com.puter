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
let lastChessComPayload = null;
let liveWatchUrl = null;
let liveWatchPlayerColor = null;
let chessComScanInFlight = false;

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
  return handleChessComScan();
}

async function handleChessComScan(options = {}) {
  const { skipDelay = false, allowCachedState = false, forceFullExtract = false } = options;
  if (chessComScanInFlight) return;
  chessComScanInFlight = true;

  try {
  // Wait briefly for the page to fully render (chess.com uses dynamic rendering)
    if (!skipDelay) await delay(1500);
    if (!runtimeAvailable) return;

    const url = window.location.href;
    const metadata = getChessComMetadata();
    const cachedPayload = lastChessComPayload?.url === url ? lastChessComPayload : null;
    const domGameOver = isChessComGameOver();

    if (allowCachedState && cachedPayload?.isGameOver && !forceFullExtract) {
      const sent = await safeSendMessage({
        type: MSG.GAME_DETECTED,
        payload: cachedPayload,
      });
      if (sent) cleanupLiveObservers();
      return;
    }

    if (allowCachedState && cachedPayload && !cachedPayload.isGameOver && !domGameOver && !forceFullExtract) {
      const sent = await sendChessComPayload({
        pgn: null,
        isGameOver: false,
        metadata,
        platform: PLATFORM.CHESSCOM,
        url,
      });
      if (!sent) return;
      ensureLiveObservers(metadata.playerColor, url);
      return;
    }

    if (domGameOver) cleanupLiveObservers();

    // Full PGN extraction is expensive; avoid it on repeated live rescans.
    const pgn = await extractChessComPgn();
    const pgnGameOver = pgn ? isGameComplete(pgn) : false;
    const isGameOver = domGameOver || pgnGameOver;

    const sent = await sendChessComPayload({
      pgn: isGameOver ? pgn : null, // Only send PGN for completed games
      isGameOver,
      metadata,
      platform: PLATFORM.CHESSCOM,
      url,
    });
    if (!sent) return;

    if (isGameOver) cleanupLiveObservers();
    else ensureLiveObservers(metadata.playerColor, url);
  } finally {
    chessComScanInFlight = false;
  }
}

/**
 * Poll for game-over state during a live game.
 * When the game ends, re-extract PGN and send a new GAME_DETECTED message.
 */
function ensureLiveObservers(playerColor, url) {
  if (liveWatchUrl && liveWatchUrl !== url) cleanupLiveObservers();

  if (!cleanupClock || liveWatchPlayerColor !== playerColor) {
    if (cleanupClock) cleanupClock();
    cleanupClock = startClockObserver((clockData) => {
      safeSendMessage({
        type: MSG.CLOCK_UPDATE,
        payload: clockData,
      });
    }, playerColor);
    liveWatchPlayerColor = playerColor;
  }

  if (currentExtractor) {
    liveWatchUrl = url;
    return;
  }

  const interval = setInterval(async () => {
    if (!runtimeAvailable) {
      cleanupLiveObservers();
      return;
    }
    if (!isChessComGameOver()) return;
    cleanupLiveObservers();

    // Wait for the post-game UI to settle before the one expensive extraction.
    await delay(2000);
    if (!runtimeAvailable) return;

    await handleChessComScan({ skipDelay: true, forceFullExtract: true });
  }, 3000);

  currentExtractor = { cleanup: () => clearInterval(interval) };
  liveWatchUrl = url;
}

async function sendChessComPayload(payload) {
  const sent = await safeSendMessage({
    type: MSG.GAME_DETECTED,
    payload,
  });
  if (sent) lastChessComPayload = payload;
  return sent;
}

function cleanupLiveObservers() {
  if (currentExtractor?.cleanup) currentExtractor.cleanup();
  if (cleanupClock) cleanupClock();
  currentExtractor = null;
  cleanupClock = null;
  liveWatchUrl = null;
  liveWatchPlayerColor = null;
}

function cleanup() {
  cleanupLiveObservers();
  lastChessComPayload = null;
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
    if (detection?.platform === PLATFORM.CHESSCOM) handleChessComScan({ skipDelay: true, allowCachedState: true });
    else if (detection?.platform === PLATFORM.LICHESS) handleLichessPage();
  }
});

// Initialize
init();
