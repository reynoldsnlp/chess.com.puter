// Detects which chess platform and page type we're on.

export const PLATFORM = {
  CHESSCOM: 'chesscom',
  LICHESS: 'lichess',
  GENERIC: 'generic',
  UNKNOWN: 'unknown',
};

export const PAGE_TYPE = {
  LIVE_GAME: 'live_game',
  DAILY_GAME: 'daily_game',
  GAME_REVIEW: 'game_review',
  ANALYSIS: 'analysis',
  ARCHIVE: 'archive',
  UNKNOWN: 'unknown',
};

/**
 * Detect the current platform and page type from the URL.
 * @returns {{ platform: string, pageType: string } | null}
 */
export function detectPlatform() {
  const { hostname, pathname } = window.location;

  // Chess.com
  if (hostname === 'www.chess.com' || hostname === 'chess.com') {
    return {
      platform: PLATFORM.CHESSCOM,
      pageType: detectChessComPageType(pathname),
    };
  }

  // Lichess
  if (hostname === 'lichess.org') {
    return {
      platform: PLATFORM.LICHESS,
      pageType: detectLichessPageType(pathname),
    };
  }

  return null;
}

function detectChessComPageType(pathname) {
  // /game/live/{id} - live game (may be active or completed)
  if (/^\/game\/live\/\d+/.test(pathname)) return PAGE_TYPE.LIVE_GAME;

  // /game/daily/{id} - daily/correspondence game
  if (/^\/game\/daily\/\d+/.test(pathname)) return PAGE_TYPE.DAILY_GAME;

  // /analysis/game/live/{id} or /analysis/game/daily/{id} - game review
  if (/^\/analysis\/game\//.test(pathname)) return PAGE_TYPE.GAME_REVIEW;

  // /analysis - free analysis board
  if (/^\/analysis/.test(pathname)) return PAGE_TYPE.ANALYSIS;

  // /live - live game lobby (not a specific game)
  if (/^\/live\b/.test(pathname)) return PAGE_TYPE.LIVE_GAME;

  // /games/archive - game archive
  if (/^\/games\/archive/.test(pathname)) return PAGE_TYPE.ARCHIVE;

  return PAGE_TYPE.UNKNOWN;
}

function detectLichessPageType(pathname) {
  // /analysis - analysis board
  if (/^\/analysis/.test(pathname)) return PAGE_TYPE.ANALYSIS;

  // /{8-char-id} - game page
  if (/^\/[a-zA-Z0-9]{8}\b/.test(pathname)) return PAGE_TYPE.LIVE_GAME;

  return PAGE_TYPE.UNKNOWN;
}
