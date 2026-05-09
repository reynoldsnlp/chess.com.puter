(() => {
  // src/shared/messages.js
  var MSG = {
    // Content script detected a game page (completed or live)
    // Payload: { pgn, isGameOver, metadata, platform }
    GAME_DETECTED: "GAME_DETECTED",
    // Service worker forwards game data to side panel (gated by isGameOver)
    // Payload: { mode: 'analysis'|'live_helper', pgn?, metadata, platform }
    GAME_DATA: "GAME_DATA",
    // Side panel requests current game data from service worker
    // Payload: { tabId }
    REQUEST_GAME: "REQUEST_GAME",
    // Side panel requests opening the game in Lichess analysis
    // Payload: { url }
    OPEN_IN_LICHESS: "OPEN_IN_LICHESS",
    // Side panel requests content script to scan the page for games
    // Routed through service worker to the active tab's content script
    // If content script is stale (extension reloaded), SW re-injects it
    SCAN_PAGE: "SCAN_PAGE"
  };

  // src/shared/gameStatus.js
  var TERMINAL_RESULTS = ["1-0", "0-1", "1/2-1/2"];
  function isGameComplete(pgn) {
    if (!pgn || typeof pgn !== "string") return false;
    const resultMatch = pgn.match(/\[Result\s+"([^"]+)"\]/);
    if (resultMatch && TERMINAL_RESULTS.includes(resultMatch[1])) {
      return true;
    }
    const trimmed = pgn.trim();
    for (const result of TERMINAL_RESULTS) {
      if (trimmed.endsWith(result)) {
        return true;
      }
    }
    const movetext = pgn.replace(/\[[^\]]*\]/g, "").trim();
    if (movetext.includes("#")) {
      const withoutComments = movetext.replace(/\{[^}]*\}/g, "");
      if (withoutComments.includes("#")) {
        return true;
      }
    }
    return false;
  }
  function isChessComGameOver() {
    const dataCySelectors = [
      '[data-cy="sidebar-game-over-new-game-button"]',
      '[data-cy="sidebar-game-over-rematch-button"]',
      '[data-cy="quick-analysis-tally-item"]'
    ];
    for (const selector of dataCySelectors) {
      if (document.querySelector(selector)) {
        return true;
      }
    }
    const classSelectors = [
      ".game-review-buttons-component",
      ".new-game-buttons-component",
      ".quick-analysis-tally-component",
      ".game-over-modal",
      ".game-over-header-component"
    ];
    for (const selector of classSelectors) {
      if (document.querySelector(selector)) {
        return true;
      }
    }
    const ariaSelectors = [
      '[aria-label="Rematch"]',
      '[aria-label="New Game"]',
      'a[href*="/analysis/game/"]'
    ];
    for (const selector of ariaSelectors) {
      if (document.querySelector(selector)) {
        return true;
      }
    }
    const pathname = window.location.pathname;
    if (/^\/analysis\/game\//.test(pathname)) {
      return true;
    }
    return false;
  }

  // src/content-scripts/platformDetector.js
  var PLATFORM = {
    CHESSCOM: "chesscom",
    LICHESS: "lichess",
    GENERIC: "generic",
    UNKNOWN: "unknown"
  };
  var PAGE_TYPE = {
    LIVE_GAME: "live_game",
    DAILY_GAME: "daily_game",
    GAME_REVIEW: "game_review",
    ANALYSIS: "analysis",
    ARCHIVE: "archive",
    UNKNOWN: "unknown"
  };
  function detectPlatform() {
    const { hostname, pathname } = window.location;
    if (hostname === "www.chess.com" || hostname === "chess.com") {
      return {
        platform: PLATFORM.CHESSCOM,
        pageType: detectChessComPageType(pathname)
      };
    }
    if (hostname === "lichess.org") {
      return {
        platform: PLATFORM.LICHESS,
        pageType: detectLichessPageType(pathname)
      };
    }
    return null;
  }
  function detectChessComPageType(pathname) {
    if (/^\/game\/live\/\d+/.test(pathname)) return PAGE_TYPE.LIVE_GAME;
    if (/^\/game\/daily\/\d+/.test(pathname)) return PAGE_TYPE.DAILY_GAME;
    if (/^\/analysis\/game\//.test(pathname)) return PAGE_TYPE.GAME_REVIEW;
    if (/^\/analysis/.test(pathname)) return PAGE_TYPE.ANALYSIS;
    if (/^\/live\b/.test(pathname)) return PAGE_TYPE.LIVE_GAME;
    if (/^\/games\/archive/.test(pathname)) return PAGE_TYPE.ARCHIVE;
    return PAGE_TYPE.UNKNOWN;
  }
  function detectLichessPageType(pathname) {
    if (/^\/analysis/.test(pathname)) return PAGE_TYPE.ANALYSIS;
    if (/^\/[a-zA-Z0-9]{8}\b/.test(pathname)) return PAGE_TYPE.LIVE_GAME;
    return PAGE_TYPE.UNKNOWN;
  }

  // src/content-scripts/observers/navigationObserver.js
  function observeNavigation(onNavigate) {
    let lastUrl = window.location.href;
    function checkUrl() {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        onNavigate(currentUrl);
      }
    }
    window.addEventListener("popstate", checkUrl);
    const titleEl = document.querySelector("title");
    let titleObserver = null;
    if (titleEl) {
      titleObserver = new MutationObserver(checkUrl);
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function(...args) {
      origPushState.apply(this, args);
      checkUrl();
    };
    history.replaceState = function(...args) {
      origReplaceState.apply(this, args);
      checkUrl();
    };
    return () => {
      window.removeEventListener("popstate", checkUrl);
      if (titleObserver) titleObserver.disconnect();
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
    };
  }

  // src/content-scripts/extractors/chesscom.js
  async function extractChessComPgn() {
    const scrapedPgn = tryMoveListScrape();
    if (scrapedPgn) {
      return scrapedPgn;
    }
    const sharePgn = await tryShareDialog();
    if (sharePgn) {
      return sharePgn;
    }
    const scriptPgn = tryScriptData();
    if (scriptPgn) {
      return scriptPgn;
    }
    return null;
  }
  function tryMoveListScrape() {
    const moveListContainer = findElement([
      '[data-cy="move-list"]',
      "wc-simple-move-list",
      ".move-list"
    ]);
    if (!moveListContainer) {
      return null;
    }
    const nodeElements = moveListContainer.querySelectorAll(".node");
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
    let pgn = "";
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) {
        pgn += `${Math.floor(i / 2) + 1}. `;
      }
      pgn += moves[i] + " ";
    }
    const result = findGameResult();
    if (result) pgn += result;
    return pgn.trim() || null;
  }
  function extractMoveText(node) {
    const contentEl = node.querySelector(".node-highlight-content") || node;
    let san = "";
    for (const child of contentEl.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        san += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const figurine = child.getAttribute("data-figurine");
        if (figurine) {
          san += figurine;
        } else {
          san += child.textContent || "";
        }
      }
    }
    san = san.trim();
    if (!san) return null;
    if (isChessMove(san)) return san;
    san = san.replace(/\s+/g, "");
    if (isChessMove(san)) return san;
    return null;
  }
  async function tryShareDialog() {
    const shareBtn = findElement([
      '[data-cy="sidebar-share-icon"]',
      'button [data-glyph="graph-nodes-share"]',
      '[aria-label="Share"]'
    ]);
    if (!shareBtn) return null;
    const clickTarget = shareBtn.closest("button") || shareBtn.closest("a") || shareBtn;
    clickTarget.click();
    const modal = await waitForElement([
      ".share-menu-tab-pgn-textarea",
      'textarea[aria-label*="PGN"]',
      ".share-menu-component textarea"
    ], 3e3);
    if (!modal) {
      closeModal();
      return null;
    }
    const pgnTab = document.querySelector("#tab-pgn") || findElementByText("button", "PGN");
    if (pgnTab) {
      pgnTab.click();
      await delay(300);
    }
    const textarea = findElement([
      ".share-menu-tab-pgn-textarea",
      'textarea[aria-label*="PGN"]',
      ".share-menu-component textarea"
    ]);
    const pgn = textarea?.value?.trim() || null;
    closeModal();
    return pgn;
  }
  function tryScriptData() {
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      const pgnMatch = text.match(/"pgn"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (pgnMatch) {
        try {
          return JSON.parse(`"${pgnMatch[1]}"`);
        } catch (e) {
          return pgnMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
      }
    }
    return null;
  }
  function getChessComMetadata() {
    const metadata = {
      white: { name: "White", rating: null },
      black: { name: "Black", rating: null },
      playerColor: "white",
      // which color the user is playing
      timeControl: null,
      url: window.location.href
    };
    const bottomPlayer = document.querySelector("#board-layout-player-bottom");
    const topPlayer = document.querySelector("#board-layout-player-top");
    const bottomClock = document.querySelector(".clock-bottom");
    if (bottomClock) {
      if (bottomClock.classList.contains("clock-black")) {
        metadata.playerColor = "black";
      } else if (bottomClock.classList.contains("clock-white")) {
        metadata.playerColor = "white";
      }
    }
    const boardEl = document.querySelector("wc-chess-board, chess-board");
    if (boardEl) {
      if (boardEl.hasAttribute("flipped") || boardEl.classList.contains("flipped")) {
        metadata.playerColor = "black";
      }
    }
    const isBlack = metadata.playerColor === "black";
    if (bottomPlayer) {
      const name = bottomPlayer.querySelector('[data-cy="user-tagline-username"], .cc-user-username-component');
      const rating = bottomPlayer.querySelector('[data-cy="user-tagline-rating"]');
      const key = isBlack ? "black" : "white";
      if (name) metadata[key].name = name.textContent?.trim();
      if (rating) metadata[key].rating = rating.textContent?.replace(/[()]/g, "").trim();
    }
    if (topPlayer) {
      const name = topPlayer.querySelector('[data-cy="user-tagline-username"], .cc-user-username-component');
      const rating = topPlayer.querySelector('[data-cy="user-tagline-rating"]');
      const key = isBlack ? "white" : "black";
      if (name) metadata[key].name = name.textContent?.trim();
      if (rating) metadata[key].rating = rating.textContent?.replace(/[()]/g, "").trim();
    }
    return metadata;
  }
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
        const el2 = findElement(selectors);
        if (el2) {
          observer.disconnect();
          resolve(el2);
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
      ".cc-modal-header-close",
      ".ui_outside-close-icon",
      '[aria-label="Close"]'
    ]);
    if (closeBtn) closeBtn.click();
  }
  var CHESS_MOVE_REGEX = /^[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?[+#]?$|^O-O(?:-O)?[+#]?$/;
  function isChessMove(text) {
    return CHESS_MOVE_REGEX.test(text);
  }
  function findGameResult() {
    const resultPatterns = ["1-0", "0-1", "1/2-1/2", "\xBD-\xBD"];
    const resultEls = document.querySelectorAll('.game-result, .result, [data-result], [data-cy*="result"]');
    for (const el of resultEls) {
      const text = el.textContent?.trim();
      if (text && resultPatterns.some((p) => text.includes(p))) {
        if (text.includes("1-0")) return "1-0";
        if (text.includes("0-1")) return "0-1";
        if (text.includes("1/2") || text.includes("\xBD")) return "1/2-1/2";
      }
    }
    return null;
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/content-scripts/extractors/lichess.js
  async function extractLichessPgn() {
    const scriptPgn = tryEmbeddedData();
    if (scriptPgn) return scriptPgn;
    const domPgn = tryMoveListScrape2();
    if (domPgn) return domPgn;
    const tabPgn = tryPgnTab();
    if (tabPgn) return tabPgn;
    return null;
  }
  function tryEmbeddedData() {
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      const pgnMatch = text.match(/"pgn"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (pgnMatch) {
        try {
          return JSON.parse(`"${pgnMatch[1]}"`);
        } catch (e) {
          return pgnMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
      }
    }
    return null;
  }
  function tryMoveListScrape2() {
    const moveContainer = document.querySelector(".analyse__moves") || document.querySelector(".tview2") || document.querySelector(".rmoves");
    if (!moveContainer) return null;
    const moves = [];
    const moveEls = moveContainer.querySelectorAll("move, kwdb");
    for (const el of moveEls) {
      const text = el.textContent?.trim();
      if (text && /^[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|^O-O/.test(text)) {
        moves.push(text);
      }
    }
    if (moves.length === 0) return null;
    let pgn = "";
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
      pgn += moves[i] + " ";
    }
    return pgn.trim() || null;
  }
  function tryPgnTab() {
    const pgnTextarea = document.querySelector(".analyse__underboard textarea");
    if (pgnTextarea?.value?.trim()) {
      return pgnTextarea.value.trim();
    }
    const pgnEl = document.querySelector(".pgn");
    if (pgnEl?.textContent?.trim()) {
      return pgnEl.textContent.trim();
    }
    return null;
  }
  function isLichessGameOver() {
    const status = document.querySelector(".status");
    if (status) {
      const text = status.textContent?.toLowerCase() || "";
      if (["checkmate", "resign", "draw", "stalemate", "timeout", "aborted"].some((t) => text.includes(t))) {
        return true;
      }
    }
    const buttons = document.querySelectorAll(".game__control button, .follow-up a");
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || "";
      if (text.includes("analysis") || text.includes("rematch") || text.includes("new opponent")) {
        return true;
      }
    }
    return false;
  }
  function getLichessMetadata() {
    const metadata = {
      white: { name: "White", rating: null },
      black: { name: "Black", rating: null },
      playerColor: "white",
      url: window.location.href
    };
    const board = document.querySelector(".cg-wrap, .main-board, cg-board");
    if (board?.classList.contains("orientation-black")) {
      metadata.playerColor = "black";
    } else if (board?.classList.contains("orientation-white")) {
      metadata.playerColor = "white";
    }
    const players = document.querySelectorAll(".game__meta__players .player");
    for (const player of players) {
      const nameEl = player.querySelector(".user-link");
      const ratingEl = player.querySelector("rating");
      const color = player.classList.contains("color-icon") ? player.querySelector(".color-icon.is.white") ? "white" : "black" : player.closest(".top") ? "black" : "white";
      const name = nameEl?.textContent?.trim();
      const rating = ratingEl?.textContent?.trim();
      if (name) {
        metadata[color].name = name;
        if (rating) metadata[color].rating = rating;
      }
    }
    return metadata;
  }

  // src/content-scripts/main.js
  var currentExtractor = null;
  var cleanupNavigation = null;
  var runtimeAvailable = true;
  var lastChessComPayload = null;
  var liveWatchUrl = null;
  var chessComScanInFlight = false;
  function isExtensionContextInvalidated(error) {
    const message = error?.message || String(error || "");
    return /Extension context invalidated/i.test(message);
  }
  function shutdownRuntime(error) {
    if (!runtimeAvailable) return;
    runtimeAvailable = false;
    cleanup();
    console.warn("chess.com.puter: content script runtime invalidated; shutting down stale observers", error);
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
      console.debug("chess.com.puter: runtime sendMessage failed", error);
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
    handlePage(detection);
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
      if (!skipDelay) await delay2(1500);
      if (!runtimeAvailable) return;
      const url = window.location.href;
      const metadata = getChessComMetadata();
      const cachedPayload = lastChessComPayload?.url === url ? lastChessComPayload : null;
      const domGameOver = isChessComGameOver();
      if (allowCachedState && cachedPayload?.isGameOver && !forceFullExtract) {
        const sent2 = await safeSendMessage({
          type: MSG.GAME_DETECTED,
          payload: cachedPayload
        });
        if (sent2) cleanupLiveObservers();
        return;
      }
      if (allowCachedState && cachedPayload && !cachedPayload.isGameOver && !domGameOver && !forceFullExtract) {
        const sent2 = await sendChessComPayload({
          pgn: null,
          isGameOver: false,
          metadata,
          platform: PLATFORM.CHESSCOM,
          url
        });
        if (!sent2) return;
        ensureLiveObservers(
          url,
          isChessComGameOver,
          () => handleChessComScan({ skipDelay: true, forceFullExtract: true })
        );
        return;
      }
      if (domGameOver) cleanupLiveObservers();
      const pgn = await extractChessComPgn();
      const pgnGameOver = pgn ? isGameComplete(pgn) : false;
      const isGameOver = domGameOver || pgnGameOver;
      const sent = await sendChessComPayload({
        pgn: isGameOver ? pgn : null,
        // Only send PGN for completed games
        isGameOver,
        metadata,
        platform: PLATFORM.CHESSCOM,
        url
      });
      if (!sent) return;
      if (isGameOver) cleanupLiveObservers();
      else {
        ensureLiveObservers(
          url,
          isChessComGameOver,
          () => handleChessComScan({ skipDelay: true, forceFullExtract: true })
        );
      }
    } finally {
      chessComScanInFlight = false;
    }
  }
  function ensureLiveObservers(url, isGameOver, onGameOver) {
    if (liveWatchUrl && liveWatchUrl !== url) cleanupLiveObservers();
    if (currentExtractor) {
      liveWatchUrl = url;
      return;
    }
    const interval = setInterval(async () => {
      if (!runtimeAvailable) {
        cleanupLiveObservers();
        return;
      }
      if (!isGameOver()) return;
      cleanupLiveObservers();
      await delay2(2e3);
      if (!runtimeAvailable) return;
      await onGameOver();
    }, 3e3);
    currentExtractor = { cleanup: () => clearInterval(interval) };
    liveWatchUrl = url;
  }
  async function sendChessComPayload(payload) {
    const sent = await safeSendMessage({
      type: MSG.GAME_DETECTED,
      payload
    });
    if (sent) lastChessComPayload = payload;
    return sent;
  }
  function cleanupLiveObservers() {
    if (currentExtractor?.cleanup) currentExtractor.cleanup();
    currentExtractor = null;
    liveWatchUrl = null;
  }
  function cleanup() {
    cleanupLiveObservers();
    lastChessComPayload = null;
  }
  function delay2(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function handleLichessPage() {
    await delay2(1e3);
    if (!runtimeAvailable) return;
    const domGameOver = isLichessGameOver();
    const pgn = await extractLichessPgn();
    const pgnGameOver = pgn ? isGameComplete(pgn) : false;
    const isGameOver = domGameOver || pgnGameOver;
    const metadata = getLichessMetadata();
    const sent = await safeSendMessage({
      type: MSG.GAME_DETECTED,
      payload: {
        pgn: isGameOver ? pgn : null,
        isGameOver,
        metadata,
        platform: PLATFORM.LICHESS,
        url: window.location.href
      }
    });
    if (!sent) return;
    if (isGameOver) cleanupLiveObservers();
    else ensureLiveObservers(window.location.href, isLichessGameOver, () => handleLichessPage());
  }
  installRuntimeListener((message, sender, sendResponse) => {
    if (message.type === MSG.REQUEST_GAME || message.type === MSG.SCAN_PAGE) {
      const detection = detectPlatform();
      if (detection?.platform === PLATFORM.CHESSCOM) handleChessComScan({ skipDelay: true, allowCachedState: true });
      else if (detection?.platform === PLATFORM.LICHESS) handleLichessPage();
    }
  });
  init();
})();
