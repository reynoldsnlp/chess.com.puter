// Message types for communication between extension contexts.
// Content script -> Service Worker -> Side Panel
//
// Note: There is intentionally NO MOVE_UPDATE message type.
// Live game streaming is absent by design to prevent cheating.

export const MSG = {
  // Content script detected a game page (completed or live)
  // Payload: { pgn, isGameOver, metadata, platform }
  GAME_DETECTED: 'GAME_DETECTED',

  // Service worker forwards game data to side panel (gated by isGameOver)
  // Payload: { mode: 'analysis'|'live_helper', pgn?, metadata, platform }
  GAME_DATA: 'GAME_DATA',

  // Side panel requests current game data from service worker
  // Payload: { tabId }
  REQUEST_GAME: 'REQUEST_GAME',

  // Side panel requests opening the game in Lichess analysis
  // Payload: { url }
  OPEN_IN_LICHESS: 'OPEN_IN_LICHESS',

  // Content script sends clock times during live games (for live helper)
  // Payload: { whiteTime, blackTime, playerColor }
  CLOCK_UPDATE: 'CLOCK_UPDATE',

  // Side panel requests content script to scan the page for games
  // Routed through service worker to the active tab's content script
  // If content script is stale (extension reloaded), SW re-injects it
  SCAN_PAGE: 'SCAN_PAGE',
};
