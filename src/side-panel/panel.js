// chess.com.puter side panel entry point.
// Manual import flow: scan page → activate import button → user clicks to load.

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';
import { uciSquares } from '../shared/chessUtils.js';
import { createBoard } from './components/board.js';
import { createMoveList } from './components/moveList.js';
import { createEvalBar } from './components/evalBar.js';
import { createMaterialPanel } from './components/materialPanel.js';
import { createEngineLines } from './components/engineLines.js';
import { createControls } from './components/controls.js';
import { createStockfishController } from './engine/stockfishController.js';
import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseSquare, makeUci as chessopsUci } from 'chessops/util';
import { analyzeGame, gameAccuracy } from './engine/gameAnalyzer.js';
import { createEvalChart } from './components/evalChart.js';
import { getLatestCompletedOpening } from '../shared/openings.js';
import { getTerminalPositionEval, normalizeScoreToWhite } from './evalUtils.js';

const CLASS_SYMBOL = {
  brilliant: '!!', great: '!',
  best: '★', excellent: '➕', good: '✔', book: '📖', forced: '→',
  inaccuracy: '?!', miss: '✗', mistake: '?', blunder: '??',
};

// --- State ---
let currentPgn = null;
let currentMode = 'lobby'; // 'lobby' | 'analysis' | 'live_helper'
let engine = null;
let currentAnalysisFen = null;
let gameClassifications = null;
let fullAnalysisCancelled = false;
let fullAnalysisRunning = false;
let playerColor = 'white';
let pendingScanData = null; // game data from last scan (not yet imported)
let savedAnalysisState = null; // analysis state saved when switching to live mode
let livePreviousMode = 'lobby';
let liveGameTabId = null; // tab that triggered live mode
let liveRefreshTimer = null;
let gameHistory = [];
let selectedHistoryId = null;
let analysisRunId = 0;
const LIVE_REFRESH_MS = 5000;

// --- DOM: Lobby ---
const lobby = document.getElementById('lobby');
const lobbyImportBtn = document.getElementById('lobby-import');
const lobbyPasteBtn = document.getElementById('lobby-paste');
const lobbySandboxBtn = document.getElementById('lobby-sandbox');
const lobbyRefreshBtn = document.getElementById('lobby-refresh');
const lobbySpinner = document.getElementById('lobby-spinner');
const lobbyStatus = document.getElementById('lobby-status');
const pgnInputArea = document.getElementById('pgn-input-area');
const pgnTextarea = document.getElementById('pgn-textarea');
const pgnAnalyzeBtn = document.getElementById('pgn-analyze');
const pgnCancelBtn = document.getElementById('pgn-cancel');
const pgnWarning = document.getElementById('pgn-warning');

// --- DOM: Header (game loaded) ---
const header = document.getElementById('header');
const historyControl = document.getElementById('history-control');
const historySelect = document.getElementById('game-history-select');
const historyOriginalLink = document.getElementById('game-history-original');
const headerBook = document.getElementById('header-book');
const btnCloseGame = document.getElementById('btn-close-game');

// --- DOM: Analysis ---
const analysisSection = document.getElementById('analysis-section');
const liveSection = document.getElementById('live-section');
const statusBar = document.getElementById('status-bar');
const analysisSummary = document.getElementById('analysis-summary');

// --- Initialize Components ---
const board = createBoard(document.getElementById('board-container'));
const evalBar = createEvalBar(document.getElementById('eval-bar'));
const materialPanel = createMaterialPanel(document.getElementById('material-panel'));

const moveList = createMoveList(document.getElementById('move-list'), (ply, fen, classification, hypoUci) => {
  const inHypo = ply === -1;
  const completedBookOpening = getLatestCompletedOpening(moveList.getCurrentPathPositions());

  board.setPosition(fen);
  materialPanel.update(fen);
  currentAnalysisFen = fen;
  if (!inHypo) updateCurrentHistoryEntry({ currentPly: ply });
  updateHeaderBookLabel(completedBookOpening);

  if (inHypo && hypoUci) {
    // Hypothetical move: light blue highlight
    const sq = uciSquares(hypoUci);
    board.setHypoLastMove(sq.from, sq.to);
  } else if (!inHypo && ply > 0) {
    const pos = moveList.getPosition(ply);
    if (pos?.uci) { const sq = uciSquares(pos.uci); board.setLastMove(sq.from, sq.to); }
  } else {
    board.setLastMove(null, null);
  }

  if (!inHypo) {
    showBoardAnnotations(ply, classification);
    evalChart.setCurrentPly(ply);
    if (classification) evalBar.update(classification.evalAfterScore || { type: 'cp', value: classification.evalAfter });
    else evalBar.reset();
  }

  engineLines.clear();
  engineLines.setFen(fen);
  if (inHypo) showHypoBestMoveArrow();
  analyzePosition(fen);
});

const engineLines = createEngineLines(document.getElementById('engine-lines'));

// --- Engine line hover/click: preview PV on board ---
let engineLineHoverFen = null; // non-null while hovering an engine-line move

engineLines.onMoveHover((fen, uciMove) => {
  engineLineHoverFen = fen;
  board.setPosition(fen);
  materialPanel.update(fen);
  const sq = uciSquares(uciMove);
  board.setHypoLastMove(sq.from, sq.to);
});

engineLines.onMoveLeave(() => {
  if (!engineLineHoverFen) return;
  engineLineHoverFen = null;
  // Restore board to the real current position
  const pos = moveList.isInHypothetical()
    ? { fen: moveList.getCurrentFen() }
    : moveList.getPosition(moveList.getCurrentPly());
  if (pos) {
    board.setPosition(pos.fen);
    materialPanel.update(pos.fen);
  }
  // Restore last-move highlight
  if (!moveList.isInHypothetical()) {
    const ply = moveList.getCurrentPly();
    const p = moveList.getPosition(ply);
    if (p?.uci) { const sq = uciSquares(p.uci); board.setLastMove(sq.from, sq.to); }
    else board.setLastMove(null, null);
  }
});

engineLines.onMoveClick((moves) => {
  engineLineHoverFen = null;

  if (moveList.isInHypothetical()) {
    // Extend/replace from the current hypothetical position
    for (const m of moves) {
      moveList.addHypotheticalMove(m);
    }
  } else {
    // Start a new hypothetical from the current main-line position
    const branchPly = moveList.getCurrentPly();
    for (let i = 0; i < moves.length; i++) {
      if (i === 0) {
        moveList.startHypothetical(branchPly, moves[i]);
      } else {
        moveList.addHypotheticalMove(moves[i]);
      }
    }
  }
  moveList.navigateHypothetical(moveList.getHypoLength() - 1);
});

function getCurrentAnalysisFen() {
  return moveList.getCurrentFen();
}

const controls = createControls(document.getElementById('control-bar'), {
  onDepthChange: () => {
    const fen = getCurrentAnalysisFen();
    if (!fen) return;
    engineLines.clear();
    if (moveList.isInHypothetical()) showHypoBestMoveArrow();
    analyzePosition(fen);
  },
  onMultiPvChange: (n) => {
    engineLines.setMaxLines(n);
    if (engine?.isReady()) engine.setMultiPV(n);
    const fen = getCurrentAnalysisFen();
    if (!fen) return;
    engineLines.clear();
    if (moveList.isInHypothetical()) showHypoBestMoveArrow();
    analyzePosition(fen);
  },
  onFlip: () => {
    board.flip();
    playerColor = playerColor === 'white' ? 'black' : 'white';
    evalBar.setFlipped(playerColor === 'black');
    materialPanel.setOrientation(playerColor);
    evalChart.setFlipped(playerColor === 'black');
    evalChart.setPlayerColor(playerColor);
    moveList.setPlayerColor(playerColor);
    if (gameClassifications) showAnalysisSummary(gameClassifications);
  },
  onEngineToggle: (on) => {
    if (!on && engine) { engine.stop(); engineLines.clear(); evalBar.reset(); board.clearAutoShapes(); }
    else if (on) {
      const fen = getCurrentAnalysisFen();
      if (fen) analyzePosition(fen);
    }
  },
  onGoStart: () => moveList.goToStart(),
  onGoBack: () => moveList.goBack(),
  onGoForward: () => moveList.goForward(),
  onGoEnd: () => moveList.goToEnd(),
});

const evalChart = createEvalChart(document.getElementById('eval-chart'));
evalChart.onClick((ply) => { moveList.closeHypothetical(); moveList.goToMove(ply); });
evalChart.onHover((ply) => moveList.setHoverPly(ply));

historySelect?.addEventListener('change', () => {
  const entryId = historySelect.value;
  if (!entryId || entryId === selectedHistoryId) return;
  loadHistoryEntry(entryId);
});

// --- Board move handler (for hypothetical lines) ---
board.onMove((from, to) => {
  // Get the current FEN before the move
  const fen = moveList.getCurrentFen();
  if (!fen) return;

  // Use chessops to validate and get SAN
  const setup = parseFen(fen);
  if (setup.isErr) return;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return;
  const chess = pos.value;

  const fromSq = parseSquare(from);
  const toSq = parseSquare(to);
  if (fromSq === undefined || toSq === undefined) return;

  // Find the legal move matching from/to (handle promotions as queen by default)
  const move = { from: fromSq, to: toSq };
  const piece = chess.board.get(fromSq);

  // Convert standard 2-square castling to king-captures-rook for chessops
  if (piece?.role === 'king') {
    const CASTLE_TO_ROOK = { e1g1: 'h1', e1c1: 'a1', e8g8: 'h8', e8c8: 'a8' };
    const rookDest = CASTLE_TO_ROOK[from + to];
    if (rookDest) move.to = parseSquare(rookDest);
  }

  // Check if it's a pawn promotion
  if (piece?.role === 'pawn') {
    const toRank = toSq >> 3;
    if (toRank === 0 || toRank === 7) move.promotion = 'queen';
  }

  if (!chess.isLegal(move)) return;

  const san = makeSan(chess, move);
  const uci = chessopsUci(move);
  chess.play(move);
  const newFen = makeFen(chess.toSetup());

  moveList.handleUserMove(uci, newFen, san);
});

// ============================================================
// LOBBY UI LOGIC
// ============================================================

function setMode(mode) {
  currentMode = mode;
  lobby.classList.toggle('hidden', mode !== 'lobby');
  header.classList.toggle('hidden', mode !== 'analysis');
  analysisSection.classList.toggle('hidden', mode !== 'analysis');
  liveSection.classList.toggle('hidden', mode !== 'live_helper');
  if (mode === 'live_helper') startLiveRefreshTimer();
  else stopLiveRefreshTimer();
  if (btnCloseGame) btnCloseGame.textContent = '\u00d7 Close game';
  if (headerBook) {
    if (mode !== 'analysis') headerBook.classList.add('hidden');
    else if (headerBook.textContent) headerBook.classList.remove('hidden');
  }
  if (statusBar) {
    statusBar.querySelector('.status-text').textContent =
      mode === 'analysis' ? 'Free the fish!' :
      mode === 'live_helper' ? 'Game in progress' : 'Free the fish!';
  }
  // Board dimensions change when sections show/hide — recalculate
  if (mode === 'analysis') scheduleBoardRedraw();
}

function scheduleBoardRedraw() {
  // Layout shifts above the board can change its screen position without resizing it.
  // Two animation frames ensures the new layout has committed before Chessground re-measures.
  requestAnimationFrame(() => requestAnimationFrame(() => board.redraw()));
}

// Paste PGN (lobby)
lobbyPasteBtn.addEventListener('click', () => {
  pgnInputArea.classList.remove('hidden');
  pgnTextarea.focus();
});

// Sandbox (lobby)
lobbySandboxBtn.addEventListener('click', () => {
  startSandbox();
});

pgnCancelBtn.addEventListener('click', () => {
  pgnInputArea.classList.add('hidden');
  pgnWarning.classList.add('hidden');
  pgnTextarea.value = '';
});

pgnAnalyzeBtn.addEventListener('click', () => {
  const pgn = pgnTextarea.value.trim();
  if (!pgn) { pgnWarning.textContent = 'Please paste a PGN.'; pgnWarning.classList.remove('hidden'); return; }
  if (!isGameComplete(pgn)) { pgnWarning.textContent = 'Game appears in progress. Only completed games can be analyzed.'; pgnWarning.classList.remove('hidden'); return; }
  pgnWarning.classList.add('hidden');
  pgnInputArea.classList.add('hidden');
  loadGame(pgn, 'white', { platform: 'pgn', metadata: {} });
});

// Import from page
lobbyImportBtn.addEventListener('click', () => {
  if (!pendingScanData?.pgn) return;
  const color = pendingScanData.metadata?.playerColor || 'white';
  loadGame(pendingScanData.pgn, color, pendingScanData);
});

// Refresh / scan page
lobbyRefreshBtn.addEventListener('click', () => scanPage());

// Close game → return to lobby
btnCloseGame.addEventListener('click', (e) => {
  e.preventDefault();
  closeGame();
});

function closeGame() {
  saveSelectedHistoryState();
  cancelAnalysis();
  selectedHistoryId = null;
  renderHistorySelect();
  currentPgn = null;
  gameClassifications = null;
  currentAnalysisFen = null;
  updateHeaderBookLabel(null);

  // Clear all analysis components
  engineLines.clear();
  evalBar.reset();
  materialPanel.reset();
  board.clearAutoShapes();
  board.clearDrawShapes();
  board.setLastMove(null, null);
  board.disableInteraction();
  board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  moveList.loadPgn(null);
  evalChart.setData([], []);
  clearAnalysisSummary();

  setMode('lobby');
  // Re-scan to see if there's still a game on the page
  scanPage();
}

// ============================================================
// PAGE SCANNING
// ============================================================

let scanning = false;
let scanResolve = null; // resolve function for the scan promise

async function scanPage() {
  if (scanning) return;
  scanning = true;
  lobbySpinner.classList.remove('hidden');
  lobbyRefreshBtn.disabled = true;
  lobbyStatus.textContent = 'Scanning...';
  pendingScanData = null;
  lobbyImportBtn.disabled = true;

  // Create a promise that resolves when receiveScanResult is called
  const scanComplete = new Promise(r => { scanResolve = r; });
  const timeout = new Promise(r => setTimeout(() => r('timeout'), 5000));
  const minTime = new Promise(r => setTimeout(r, 1000));

  // Tell content script to scan (SW will re-inject if stale)
  try { chrome.runtime.sendMessage({ type: MSG.SCAN_PAGE }); } catch (e) {}

  // Also check cached data (in case content script already reported)
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME });
    if (resp?.payload?.mode !== 'idle') receiveScanResult(resp.payload);
  } catch (e) {}

  // Wait for either: scan result arrives, or 5s timeout
  await Promise.race([scanComplete, timeout]);
  // Ensure spinner shows for at least 1s
  await minTime;

  lobbySpinner.classList.add('hidden');
  lobbyRefreshBtn.disabled = false;
  scanning = false;
  scanResolve = null;

  if (currentMode === 'lobby' && !pendingScanData?.pgn && lobbyStatus.textContent === 'Scanning...') {
    lobbyStatus.textContent = 'No completed game found on this page.';
  }
}

function receiveScanResult(payload) {
  if (currentMode !== 'lobby') return;
  const { mode, pgn, metadata } = payload;
  if (mode === 'analysis' && pgn) {
    pendingScanData = {
      pgn,
      metadata,
      platform: payload.platform,
      url: payload.url,
      tabId: payload.tabId,
    };
    lobbyImportBtn.disabled = false;
    lobbyStatus.textContent = 'Completed game found! Click Import to analyze.';
  } else if (mode === 'live_helper') {
    pendingScanData = null;
    lobbyImportBtn.disabled = true;
    handleLiveGameDetected(payload);
  } else {
    pendingScanData = null;
    lobbyImportBtn.disabled = true;
    lobbyStatus.textContent = 'No completed game found on this page.';
  }
  // Signal that scan is complete (stop spinner)
  if (scanResolve) scanResolve();
}

// ============================================================
// PLAYER DETECTION
// ============================================================

function isMyMove(ply) {
  return playerColor === 'white' ? ply % 2 === 1 : ply % 2 === 0;
}

// ============================================================
// GAME HISTORY
// ============================================================

function upsertHistoryEntry(pgn, detectedColor, source = {}) {
  const next = buildHistoryEntry(pgn, detectedColor, source);
  const existingIndex = gameHistory.findIndex((entry) => entry.id === next.id);

  if (existingIndex >= 0) {
    const existing = gameHistory[existingIndex];
    const updated = {
      ...existing,
      ...next,
      gameClassifications: existing.gameClassifications || null,
      currentPly: existing.currentPly || 0,
    };
    gameHistory.splice(existingIndex, 1);
    gameHistory.unshift(updated);
    return updated;
  }

  gameHistory.unshift(next);
  return next;
}

function buildHistoryEntry(pgn, detectedColor, source = {}) {
  const headers = parsePgnHeaders(pgn);
  const metadata = source.metadata || {};
  const sourceUrl = source.url || metadata.url || headers.Site || '';
  const sourcePlatform = normalizePlatform(source.platform);
  const urlPlatform = platformFromUrl(sourceUrl);
  const platform = sourcePlatform !== 'pgn' ? sourcePlatform : urlPlatform;
  const playerSide = normalizeColor(detectedColor || metadata.playerColor || 'white');
  const opponentSide = playerSide === 'black' ? 'white' : 'black';
  const whiteName = playerName('white', headers, metadata);
  const blackName = playerName('black', headers, metadata);
  const whiteRating = playerRating('white', headers, metadata);
  const blackRating = playerRating('black', headers, metadata);
  const result = normalizeResult(headers.Result || trailingResult(pgn));
  const playerResult = resultForColor(result, playerSide);
  const originalUrl = originalGameUrl(sourceUrl, platform);
  const opponentName = opponentSide === 'white' ? whiteName : blackName;
  const opponentRating = opponentSide === 'white' ? whiteRating : blackRating;
  const analyzedAt = Date.now();

  return {
    id: historyKey(pgn, platform, originalUrl),
    pgn,
    playerColor: playerSide,
    platform,
    url: originalUrl,
    opponentName,
    opponentRating,
    playerResult,
    result,
    whiteName,
    blackName,
    analyzedAt,
    currentPly: 0,
    gameClassifications: null,
  };
}

function renderHistorySelect() {
  if (!historyControl || !historySelect) return;
  historyControl.classList.toggle('hidden', gameHistory.length === 0);
  historySelect.innerHTML = '';

  const placeholder = new Option('Analyzed games', '');
  placeholder.disabled = true;
  historySelect.appendChild(placeholder);

  for (const entry of gameHistory) {
    const option = new Option(formatHistoryOption(entry), entry.id);
    option.title = formatHistoryTitle(entry);
    historySelect.appendChild(option);
  }

  historySelect.value = selectedHistoryId || '';
  if (!historySelect.value) historySelect.selectedIndex = 0;

  const selectedEntry = gameHistory.find((entry) => entry.id === selectedHistoryId);
  const hasUrl = Boolean(selectedEntry?.url);
  if (historyOriginalLink) {
    historyOriginalLink.classList.toggle('hidden', !hasUrl);
    historyOriginalLink.href = hasUrl ? selectedEntry.url : '#';
    historyOriginalLink.title = hasUrl ? selectedEntry.url : '';
  }
}

function saveSelectedHistoryState() {
  if (!selectedHistoryId || !currentPgn) return;
  updateCurrentHistoryEntry({
    currentPly: moveList.getCurrentPly(),
    gameClassifications,
  });
}

function updateCurrentHistoryEntry(patch) {
  if (!selectedHistoryId) return;
  const entry = gameHistory.find((item) => item.id === selectedHistoryId);
  if (!entry) return;
  Object.assign(entry, patch);
}

async function loadHistoryEntry(entryId) {
  const entry = gameHistory.find((item) => item.id === entryId);
  if (!entry) return;

  saveSelectedHistoryState();
  cancelAnalysis();
  selectedHistoryId = entry.id;
  renderHistorySelect();

  await loadGameView(entry.pgn, entry.playerColor, {
    classifications: entry.gameClassifications,
    currentPly: entry.currentPly || 0,
    runFullAnalysis: !entry.gameClassifications,
  });
}

function formatHistoryOption(entry) {
  const rating = entry.opponentRating ? ` (${entry.opponentRating})` : '';
  const result = entry.playerResult || '?';
  return `${result} vs ${entry.opponentName}${rating} | ${platformLabel(entry.platform)} | ${formatHistoryTime(entry.analyzedAt)}`;
}

function formatHistoryTitle(entry) {
  const result = entry.result || 'unknown result';
  const link = entry.url ? ` | ${entry.url}` : '';
  return `${entry.whiteName} vs ${entry.blackName} | ${result} | ${platformLabel(entry.platform)}${link}`;
}

function formatHistoryTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function parsePgnHeaders(pgn) {
  const headers = {};
  const tagPattern = /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\"|[^"])*)"\]\s*$/gm;
  let match;
  while ((match = tagPattern.exec(pgn))) {
    headers[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return headers;
}

function playerName(color, headers, metadata) {
  const label = color === 'white' ? 'White' : 'Black';
  const metaName = metadata?.[color]?.name;
  const headerName = headers[label];
  if (metaName && metaName !== label) return metaName;
  return headerName || metaName || label;
}

function playerRating(color, headers, metadata) {
  const label = color === 'white' ? 'White' : 'Black';
  return metadata?.[color]?.rating || headers[`${label}Elo`] || headers[`${label}Rating`] || null;
}

function trailingResult(pgn) {
  const match = pgn.trim().match(/(1-0|0-1|1\/2-1\/2)\s*$/);
  return match?.[1] || null;
}

function normalizeResult(result) {
  return ['1-0', '0-1', '1/2-1/2'].includes(result) ? result : null;
}

function resultForColor(result, color) {
  if (result === '1/2-1/2') return 'D';
  if (result === '1-0') return color === 'white' ? 'W' : 'L';
  if (result === '0-1') return color === 'black' ? 'W' : 'L';
  return '?';
}

function normalizeColor(color) {
  return color === 'black' ? 'black' : 'white';
}

function normalizePlatform(platform) {
  if (platform === 'chesscom' || platform === 'chess.com') return 'chesscom';
  if (platform === 'lichess' || platform === 'lichess.org') return 'lichess';
  return 'pgn';
}

function platformFromUrl(url) {
  if (/^https?:\/\/(?:www\.)?chess\.com\//i.test(url)) return 'chesscom';
  if (/^https?:\/\/lichess\.org\//i.test(url)) return 'lichess';
  return 'pgn';
}

function platformLabel(platform) {
  if (platform === 'chesscom') return 'chess.com';
  if (platform === 'lichess') return 'lichess.org';
  return 'PGN';
}

function originalGameUrl(url, platform) {
  if (!url || platform === 'pgn') return '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function historyKey(pgn, platform, url) {
  if (url) return `${platform}:${url}`;
  return `pgn:${hashString(pgn)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cancelAnalysis() {
  fullAnalysisCancelled = true;
  fullAnalysisRunning = false;
  analysisRunId += 1;
  if (engine) engine.stop();
}

// ============================================================
// LOAD & ANALYZE GAME
// ============================================================

async function loadGame(pgn, detectedColor, source = {}) {
  if (!pgn) return;
  if (!isGameComplete(pgn)) return;

  const entry = upsertHistoryEntry(pgn, detectedColor, source);
  await loadHistoryEntry(entry.id);
}

async function loadGameView(pgn, detectedColor, options = {}) {
  const classifications = options.classifications || null;
  const currentPly = options.currentPly || 0;
  const runFullAnalysis = options.runFullAnalysis !== false && !classifications;

  currentPgn = pgn;
  gameClassifications = classifications;
  playerColor = normalizeColor(detectedColor);
  fullAnalysisCancelled = false;
  fullAnalysisRunning = runFullAnalysis;
  setMode('analysis');

  clearAnalysisSummary();
  scheduleBoardRedraw();
  board.clearDrawShapes();
  materialPanel.reset();
  materialPanel.setOrientation(playerColor);
  moveList.loadPgn(pgn);
  moveList.setPlayerColor(playerColor);
  board.setOrientation(playerColor);
  board.enableInteraction();
  evalBar.setFlipped(playerColor === 'black');
  evalChart.setFlipped(playerColor === 'black');
  evalChart.setPlayerColor(playerColor);

  if (classifications) {
    moveList.setClassifications(classifications);
    const positions = moveList.getAllPositions();
    evalChart.setData(classifications, positions);
    evalChart.setCurrentPly(currentPly);
    showAnalysisSummary(classifications);
  } else {
    evalChart.setData([], []);
  }

  const targetPly = Math.min(currentPly, moveList.getTotalPlies());
  if (targetPly > 0) moveList.goToMove(targetPly);

  if (runFullAnalysis) {
    await runFullGameAnalysis();
  } else {
    const pos = moveList.getPosition(moveList.getCurrentPly());
    if (pos) analyzePosition(pos.fen);
  }
}

async function startSandbox(initialColor = 'white') {
  saveSelectedHistoryState();
  cancelAnalysis();
  selectedHistoryId = null;
  renderHistorySelect();
  currentPgn = null;
  gameClassifications = null;
  playerColor = initialColor || 'white';
  setMode('analysis');

  board.clearDrawShapes();
  materialPanel.reset();
  materialPanel.setOrientation(playerColor);
  moveList.loadStartingPosition();
  moveList.setPlayerColor(playerColor);
  board.setOrientation(playerColor);
  board.enableInteraction();
  evalBar.setFlipped(playerColor === 'black');
  evalChart.setFlipped(playerColor === 'black');
  evalChart.setPlayerColor(playerColor);
  evalChart.setData([], []);
  clearAnalysisSummary();
  scheduleBoardRedraw();

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  board.setPosition(startFen);
  board.setLastMove(null, null);
  analyzePosition(startFen);
}

async function runFullGameAnalysis() {
  const runId = ++analysisRunId;
  const runHistoryId = selectedHistoryId;

  const positions = moveList.getAllPositions();
  if (positions.length < 2) {
    fullAnalysisRunning = false;
    return;
  }

  fullAnalysisCancelled = false;
  fullAnalysisRunning = true;

  const partialClassifications = [null]; // accumulates as analysis progresses
  showAnalysisSummary(partialClassifications, { pulse: false });
  evalChart.setData(partialClassifications, positions);
  scheduleBoardRedraw();

  if (!engine) await initEngine();
  if (runId !== analysisRunId) return;
  if (!engine?.isReady()) {
    await new Promise(r => setTimeout(r, 2000));
    if (runId !== analysisRunId) return;
    if (!engine) await initEngine();
    if (runId !== analysisRunId) return;
    if (!engine?.isReady()) {
      fullAnalysisRunning = false;
      return;
    }
  }

  const analyzedClassifications = await analyzeGame(positions, engine, {
    depth: 16,
    onMoveAnalyzed(ply, cls) {
      if (runId !== analysisRunId) return;
      // Accumulate classifications incrementally
      while (partialClassifications.length <= ply) partialClassifications.push(null);
      partialClassifications[ply] = cls;

      // Incrementally colorize/classify the move in the move list
      moveList.updateClassification(ply, cls);
      showAnalysisSummary(partialClassifications, { pulse: true });

      // Incrementally build eval chart using the final move spacing.
      evalChart.setData(partialClassifications, positions);
      evalChart.setCurrentPly(moveList.getCurrentPly());

      // If user is viewing this ply, update board annotations and eval bar
      if (moveList.getCurrentPly() === ply && !moveList.isInHypothetical()) {
        showBoardAnnotations(ply, cls);
        evalBar.update(cls.evalAfterScore || { type: 'cp', value: cls.evalAfter });
      }
    },
    onComplete(classifications) {
      if (runId !== analysisRunId) return;
      fullAnalysisRunning = false;
      moveList.setClassifications(classifications);
      gameClassifications = classifications;
      if (runHistoryId && selectedHistoryId === runHistoryId) {
        updateCurrentHistoryEntry({
          gameClassifications: classifications,
          currentPly: moveList.getCurrentPly(),
        });
      }
      showAnalysisSummary(classifications, { pulse: false });
      scheduleBoardRedraw();
      evalChart.setData(classifications, positions);
      evalChart.setCurrentPly(moveList.getCurrentPly());
      engine.setMultiPV(controls.getMultiPv());
      const ply = moveList.getCurrentPly();
      showBoardAnnotations(ply, moveList.getClassification(ply));
      // Start live analysis for the current position
      const pos = moveList.getPosition(ply);
      if (pos) analyzePosition(pos.fen);
    },
    isCancelled: () => fullAnalysisCancelled || runId !== analysisRunId,
  });
  if (runId === analysisRunId && analyzedClassifications) {
    gameClassifications = analyzedClassifications;
  }
}

// ============================================================
// ANALYSIS SUMMARY
// ============================================================

let previousSummaryValues = null;

function clearAnalysisSummary() {
  previousSummaryValues = null;
  if (!analysisSummary) return;
  analysisSummary.innerHTML = '';
  analysisSummary.classList.add('hidden');
}

function showAnalysisSummary(classifications, options = {}) {
  if (!analysisSummary) return;
  const shouldPulse = Boolean(options.pulse && previousSummaryValues);
  const counts = { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, forced: 0, inaccuracy: 0, miss: 0, mistake: 0, blunder: 0 };
  for (let ply = 1; ply < classifications.length; ply++) {
    if (!isMyMove(ply)) continue;
    const cls = classifications[ply];
    if (cls && counts[cls.classification] !== undefined) counts[cls.classification]++;
  }
  const topItems = [
    { key: 'brilliant', label: CLASS_SYMBOL.brilliant },
    { key: 'great', label: CLASS_SYMBOL.great },
    { key: 'best', label: CLASS_SYMBOL.best },
    { key: 'excellent', label: CLASS_SYMBOL.excellent },
    { key: 'good', label: CLASS_SYMBOL.good },
  ];
  const bottomItems = [
    { key: 'inaccuracy', label: CLASS_SYMBOL.inaccuracy },
    { key: 'miss', label: CLASS_SYMBOL.miss },
    { key: 'mistake', label: CLASS_SYMBOL.mistake },
    { key: 'blunder', label: CLASS_SYMBOL.blunder },
  ];
  const items = [...topItems, ...bottomItems];
  const accuracy = gameAccuracy(classifications, isMyMove);
  const values = {
    accuracy: `${accuracy.toFixed(1)}%`,
    ...Object.fromEntries(items.map(({ key }) => [key, String(counts[key])])),
  };
  const pulseClass = (key) => (
    shouldPulse && previousSummaryValues[key] !== values[key] ? ' summary-item-pulse' : ''
  );

  const renderItem = ({ key, label }) =>
    `<span class="summary-item summary-${key}${pulseClass(key)}" title="${key}"><span class="summary-icon">${label}</span> ${values[key]}</span>`;
  analysisSummary.innerHTML = `<div class="summary-grid">
    <div class="summary-accuracy-col">
      <span class="summary-item summary-accuracy${pulseClass('accuracy')}" title="Accuracy (Lichess formula)">${values.accuracy}</span>
    </div>
    <div class="summary-counts-col">
      <div class="summary-row">${topItems.map(renderItem).join('')}</div>
      <div class="summary-row">${bottomItems.map(renderItem).join('')}</div>
    </div>
  </div>`;
  analysisSummary.classList.remove('hidden');
  previousSummaryValues = values;
}

// ============================================================
// BOARD ANNOTATIONS
// ============================================================

function showBoardAnnotations(ply, classification) {
  if (!controls.isEngineOn()) { board.clearAutoShapes(); return; }
  const shapes = [];
  if (classification?.engineBestMove?.length >= 4) {
    const sq = uciSquares(classification.engineBestMove);
    shapes.push({ orig: sq.from, dest: sq.to, brush: 'engine' });
  }
  if (ply > 0 && classification) {
    const pos = moveList.getPosition(ply);
    if (pos?.uci) {
      const sq = uciSquares(pos.uci);
      const symbol = CLASS_SYMBOL[classification.classification];
      const color = classificationColor(classification.classification);
      if (symbol && sq.to) {
        shapes.push({ orig: sq.to, customSvg: { html: makeClassificationSvg(symbol, color) } });
      }
    }
  }
  board.setAutoShapes(shapes);
}

function classificationColor(cls) {
  return { brilliant: '#26c2a3', great: '#5c8bb0', best: '#96bc4b', excellent: '#96bc4b', good: '#97af8b', book: '#a88865', forced: '#999', inaccuracy: '#f7c631', miss: '#fa412d', mistake: '#e69a28', blunder: '#ca3431' }[cls] || '#999';
}

function makeClassificationSvg(symbol, color) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="85" cy="15" r="16" fill="${color}" opacity="0.9"/>
    <text x="85" y="15" text-anchor="middle" dominant-baseline="central"
          font-size="18" font-weight="bold" fill="white" font-family="sans-serif">${symbol}</text>
  </svg>`;
}

function showHypoBestMoveArrow() {
  if (!controls.isEngineOn() || !moveList.isInHypothetical()) { board.clearAutoShapes(); return; }
  const bestMove = engineLines.getBestMove();
  if (!bestMove?.length) { board.clearAutoShapes(); return; }
  const sq = uciSquares(bestMove);
  board.setAutoShapes([{ orig: sq.from, dest: sq.to, brush: 'lightblue' }]);
}

function updateHeaderBookLabel(opening) {
  if (!headerBook) return;

  if (!opening) {
    headerBook.textContent = '';
    headerBook.title = '';
    headerBook.classList.add('hidden');
    return;
  }

  headerBook.textContent = `Book: ${opening.name}`;
  headerBook.title = `${opening.eco} ${opening.name}`;
  headerBook.classList.remove('hidden');
}

// ============================================================
// ENGINE
// ============================================================

async function initEngine() {
  if (engine) return;
  engine = createStockfishController({
    onInfo(info) {
      if (currentAnalysisFen && getTerminalPositionEval(currentAnalysisFen)) return;

      const blackToMove = currentAnalysisFen?.split(' ')[1] === 'b';
      const terminalWinner = info.score?.type === 'mate' && info.score.value === 0 && currentAnalysisFen
        ? getTerminalPositionEval(currentAnalysisFen)?.score?.winner || null
        : null;
      if (info.score) info.score = normalizeScoreToWhite(info.score, blackToMove, terminalWinner);
      engineLines.updateLine(info);
      const bestEval = engineLines.getBestEval();
      if (bestEval) evalBar.update(bestEval);
      if (moveList.isInHypothetical()) showHypoBestMoveArrow();
    },
    onBestMove() {
      if (currentAnalysisFen && getTerminalPositionEval(currentAnalysisFen)) return;

      engineLines.setFinalized();
      if (moveList.isInHypothetical()) showHypoBestMoveArrow();
    },
    onStatus(status) {
      const el = statusBar?.querySelector('.status-text');
      if (!el) return;
      if (status.state === 'analyzing') {
        const nps = status.nps ? ` | ${(status.nps / 1e6).toFixed(1)} MN/s` : '';
        el.textContent = `SF 18 | d${status.depth}${nps} | Free the fish!`;
      } else if (status.state === 'ready') el.textContent = 'Free the fish!';
      else el.textContent = status.text;
    },
  });
  await engine.init();
  if (engine.isReady()) engine.setMultiPV(controls.getMultiPv());
}

async function analyzePosition(fen) {
  if (!controls.isEngineOn() || currentMode !== 'analysis') return;
  if (fullAnalysisRunning) return;
  currentAnalysisFen = fen;
  engineLines.setFen(fen);
  const terminalEval = getTerminalPositionEval(fen);
  if (terminalEval) {
    if (engine?.isReady()) engine.stop();
    engineLines.clear();
    if (moveList.isInHypothetical()) showHypoBestMoveArrow();
    evalBar.update(terminalEval.score);
    return;
  }
  if (!engine) await initEngine();
  if (engine?.isReady()) engine.analyze(fen, controls.getDepth());
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.GAME_DATA) {
    const payload = message.payload;

    if (payload.mode === 'live_helper') {
      if (currentMode === 'live_helper') {
        if (!liveGameTabId || payload.tabId === liveGameTabId) {
          liveGameTabId = payload.tabId || liveGameTabId;
        }
      } else handleLiveGameDetected(payload);
    } else if (currentMode === 'live_helper') {
      if (!liveGameTabId || payload.tabId === liveGameTabId) {
        handleLiveGameEnded(payload);
      }
    } else if (currentMode === 'lobby') {
      receiveScanResult(payload);
    }
  }
});

// ============================================================
// STARTUP
// ============================================================

setMode('lobby');
// Immediately scan the current page
scanPage();

// Also scan when the tab changes (user switches tabs)
chrome.tabs?.onActivated?.addListener?.(() => {
  if (currentMode === 'lobby') scanPage();
});

// ============================================================
// LIVE GAME DETECTION (any tab)
// ============================================================

function handleLiveGameDetected(payload) {
  if (currentMode === 'live_helper') {
    liveGameTabId = payload.tabId || liveGameTabId;
    return;
  }

  livePreviousMode = currentMode;
  savedAnalysisState = currentMode === 'analysis' ? captureAnalysisState() : null;
  liveGameTabId = payload.tabId || null;

  if (currentMode === 'analysis') suspendAnalysisForLiveHelper();

  setMode('live_helper');
}

function startLiveRefreshTimer() {
  if (liveRefreshTimer) return;
  liveRefreshTimer = setInterval(refreshLiveGameState, LIVE_REFRESH_MS);
}

function stopLiveRefreshTimer() {
  if (!liveRefreshTimer) return;
  clearInterval(liveRefreshTimer);
  liveRefreshTimer = null;
}

async function refreshLiveGameState() {
  if (currentMode !== 'live_helper') return;

  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME });
    const payload = resp?.payload || { mode: 'idle' };

    if (payload.mode === 'live_helper') {
      liveGameTabId = payload.tabId || liveGameTabId;
      return;
    }

    await handleLiveGameEnded(payload);
  } catch (e) {
    // Keep the live gate in place if the service worker cannot answer.
  }
}

async function handleLiveGameEnded(payload) {
  const restoreMode = livePreviousMode;
  const restoreState = savedAnalysisState;

  liveGameTabId = null;
  livePreviousMode = 'lobby';
  savedAnalysisState = null;

  if (payload?.mode === 'analysis' && payload.pgn && isGameComplete(payload.pgn)) {
    const color = payload.metadata?.playerColor || restoreState?.playerColor || 'white';
    await loadGame(payload.pgn, color, payload);
    return;
  }

  if (restoreMode === 'analysis' && restoreState) {
    restoreAnalysisState(restoreState);
  } else {
    setMode('lobby');
    receiveScanResult(payload);
  }
}

function captureAnalysisState() {
  if (currentMode !== 'analysis') return null;

  if (currentPgn) {
    return {
      kind: 'pgn',
      pgn: currentPgn,
      playerColor,
      gameClassifications,
      currentPly: moveList.getCurrentPly(),
      rerunFullAnalysis: fullAnalysisRunning,
      historyId: selectedHistoryId,
    };
  }

  return {
    kind: 'sandbox',
    playerColor,
  };
}

function suspendAnalysisForLiveHelper() {
  saveSelectedHistoryState();
  cancelAnalysis();
}

function restoreAnalysisState(state) {
  if (!state) {
    setMode('lobby');
    scanPage();
    return;
  }

  if (state.kind === 'sandbox') {
    startSandbox(state.playerColor);
    return;
  }

  currentPgn = state.pgn;
  playerColor = state.playerColor;
  gameClassifications = null;
  fullAnalysisCancelled = false;
  fullAnalysisRunning = Boolean(state.rerunFullAnalysis);
  selectedHistoryId = state.historyId || null;
  renderHistorySelect();

  setMode('analysis');

  materialPanel.reset();
  materialPanel.setOrientation(state.playerColor);
  moveList.loadPgn(state.pgn);
  moveList.setPlayerColor(state.playerColor);
  board.setOrientation(state.playerColor);
  board.enableInteraction();
  evalBar.setFlipped(state.playerColor === 'black');
  evalChart.setFlipped(state.playerColor === 'black');
  evalChart.setPlayerColor(state.playerColor);

  if (state.gameClassifications) {
    gameClassifications = state.gameClassifications;
    moveList.setClassifications(state.gameClassifications);
    const positions = moveList.getAllPositions();
    evalChart.setData(state.gameClassifications, positions);
    evalChart.setCurrentPly(state.currentPly || 0);
    showAnalysisSummary(state.gameClassifications);
  } else {
    evalChart.setData([], []);
    evalChart.setCurrentPly(state.currentPly || 0);
    clearAnalysisSummary();
  }

  if (state.currentPly > 0) moveList.goToMove(state.currentPly);

  const pos = moveList.getPosition(moveList.getCurrentPly());
  if (state.rerunFullAnalysis) runFullGameAnalysis();
  else if (pos) analyzePosition(pos.fen);
}
