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

function init() {
  const detection = detectPlatform();
  if (!detection) return;

  // Run extraction for the current page
  handlePage(detection);

  // Watch for SPA navigation (chess.com is a React SPA)
  cleanupNavigation = observeNavigation(() => {
    cleanup();
    const newDetection = detectPlatform();
    if (newDetection) handlePage(newDetection);
  });
}

async function handlePage(detection) {
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

  // Check if the game is over using DOM signals
  const domGameOver = isChessComGameOver();
  console.log('chess.com.puter: DOM game over:', domGameOver);

  // Try to extract PGN
  const pgn = await extractChessComPgn();
  console.log('chess.com.puter: extracted PGN:', pgn ? pgn.substring(0, 100) + '...' : null);

  const pgnGameOver = pgn ? isGameComplete(pgn) : false;
  console.log('chess.com.puter: PGN game over:', pgnGameOver);

  const isGameOver = domGameOver || pgnGameOver;

  // Get player metadata
  const metadata = getChessComMetadata();

  // Send game detection message
  chrome.runtime.sendMessage({
    type: MSG.GAME_DETECTED,
    payload: {
      pgn: isGameOver ? pgn : null, // Only send PGN for completed games
      isGameOver,
      metadata,
      platform: PLATFORM.CHESSCOM,
      url: window.location.href,
    },
  });

  // If game is live, start observing clocks for the live helper
  if (!isGameOver) {
    cleanupClock = startClockObserver((clockData) => {
      chrome.runtime.sendMessage({
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
    if (isChessComGameOver()) {
      clearInterval(interval);
      if (cleanupClock) {
        cleanupClock();
        cleanupClock = null;
      }

      // Wait for the post-game UI to settle
      await delay(2000);

      const pgn = await extractChessComPgn();
      const metadata = getChessComMetadata();

      chrome.runtime.sendMessage({
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

  const domGameOver = isLichessGameOver();
  const pgn = await extractLichessPgn();
  const pgnGameOver = pgn ? isGameComplete(pgn) : false;
  const isGameOver = domGameOver || pgnGameOver;
  const metadata = getLichessMetadata();

  chrome.runtime.sendMessage({
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.REQUEST_GAME) {
    const detection = detectPlatform();
    if (detection?.platform === PLATFORM.CHESSCOM) handleChessComPage();
    else if (detection?.platform === PLATFORM.LICHESS) handleLichessPage();
  }
});

// Initialize
init();
