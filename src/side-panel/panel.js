// chess.com.puter side panel entry point.
// Manual import flow: scan page → activate import button → user clicks to load.

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';
import { uciSquares } from '../shared/chessUtils.js';
import { createBoard } from './components/board.js';
import { createMoveList } from './components/moveList.js';
import { createEvalBar } from './components/evalBar.js';
import { createEngineLines } from './components/engineLines.js';
import { createControls } from './components/controls.js';
import { createLiveHelper } from './live-helper/liveHelper.js';
import { createStockfishController } from './engine/stockfishController.js';
import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseSquare, makeUci as chessopsUci } from 'chessops/util';
import { analyzeGame, gameAccuracy } from './engine/gameAnalyzer.js';
import { createEvalChart } from './components/evalChart.js';

const CLASS_SYMBOL = {
  best: '★', excellent: '➕', good: '✔', book: '📖', forced: '→',
  inaccuracy: '?!', mistake: '?', blunder: '??',
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
let liveGameTabId = null; // tab that triggered the live-helper mode

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
const btnCloseGame = document.getElementById('btn-close-game');

// --- DOM: Analysis ---
const analysisSection = document.getElementById('analysis-section');
const liveSection = document.getElementById('live-section');
const statusBar = document.getElementById('status-bar');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const analysisSummary = document.getElementById('analysis-summary');

// --- Initialize Components ---
const board = createBoard(document.getElementById('board-container'));
const evalBar = createEvalBar(document.getElementById('eval-bar'));

const moveList = createMoveList(document.getElementById('move-list'), (ply, fen, classification, hypoUci) => {
  const inHypo = ply === -1;

  board.setPosition(fen);
  currentAnalysisFen = fen;

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
    hypoBestAlternative = null;
    showBoardAnnotations(ply, classification);
    evalChart.setCurrentPly(ply);
    if (classification) evalBar.update({ type: 'cp', value: classification.evalAfter });
    else evalBar.reset();
  } else {
    // Capture the best move from the *previous* position's analysis
    // before clearing — this is the best alternative to the move just played.
    hypoBestAlternative = engineLines.getBestMove();
    showHypoBestMoveArrow();
  }

  engineLines.clear();
  engineLines.setFen(fen);
  analyzePosition(fen);
});

const engineLines = createEngineLines(document.getElementById('engine-lines'));

// --- Engine line hover/click: preview PV on board ---
let engineLineHoverFen = null; // non-null while hovering an engine-line move

engineLines.onMoveHover((fen, uciMove) => {
  engineLineHoverFen = fen;
  board.setPosition(fen);
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
  if (pos) board.setPosition(pos.fen);
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

  // Show the last clicked move as the best-move arrow
  const lastMove = moves[moves.length - 1];
  if (lastMove?.uci) {
    const sq = uciSquares(lastMove.uci);
    board.setAutoShapes([{ orig: sq.from, dest: sq.to, brush: 'lightblue' }]);
  }
});

const controls = createControls(document.getElementById('control-bar'), {
  onDepthChange: (d) => { const p = moveList.getPosition(moveList.getCurrentPly()); if (p && engine?.isReady()) { engineLines.clear(); engine.analyze(p.fen, d); } },
  onMultiPvChange: (n) => {
    engineLines.setMaxLines(n);
    if (engine?.isReady()) {
      engine.setMultiPV(n);
      const p = moveList.getPosition(moveList.getCurrentPly());
      if (p) { engineLines.clear(); engine.analyze(p.fen, controls.getDepth()); }
    }
  },
  onFlip: () => {
    board.flip();
    playerColor = playerColor === 'white' ? 'black' : 'white';
    evalBar.setFlipped(playerColor === 'black');
    evalChart.setFlipped(playerColor === 'black');
    evalChart.setPlayerColor(playerColor);
    moveList.setPlayerColor(playerColor);
    if (gameClassifications) showAnalysisSummary(gameClassifications);
  },
  onEngineToggle: (on) => {
    if (!on && engine) { engine.stop(); engineLines.clear(); evalBar.reset(); board.clearAutoShapes(); }
    else if (on) { const p = moveList.getPosition(moveList.getCurrentPly()); if (p) analyzePosition(p.fen); }
  },
  onGoStart: () => moveList.goToStart(),
  onGoBack: () => moveList.goBack(),
  onGoForward: () => moveList.goForward(),
  onGoEnd: () => moveList.goToEnd(),
  getCurrentPgn: () => currentPgn,
});

const evalChart = createEvalChart(document.getElementById('eval-chart'));
evalChart.onClick((ply) => { moveList.closeHypothetical(); moveList.goToMove(ply); });
evalChart.onHover((ply) => moveList.setHoverPly(ply));

const liveHelper = createLiveHelper(document.getElementById('live-section'));

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
  header.classList.toggle('hidden', mode === 'lobby');
  analysisSection.classList.toggle('hidden', mode !== 'analysis');
  liveSection.classList.toggle('hidden', mode !== 'live_helper');
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
  loadGame(pgn, 'white');
});

// Import from page
lobbyImportBtn.addEventListener('click', () => {
  if (!pendingScanData?.pgn) return;
  const color = pendingScanData.metadata?.playerColor || 'white';
  loadGame(pendingScanData.pgn, color);
});

// Refresh / scan page
lobbyRefreshBtn.addEventListener('click', () => scanPage());

// Close game → return to lobby
btnCloseGame.addEventListener('click', (e) => {
  e.preventDefault();
  closeGame();
});

function closeGame() {
  fullAnalysisCancelled = true;
  fullAnalysisRunning = false;
  if (engine) engine.stop();
  currentPgn = null;
  gameClassifications = null;
  currentAnalysisFen = null;

  // Clear all analysis components
  engineLines.clear();
  evalBar.reset();
  board.clearAutoShapes();
  board.clearDrawShapes();
  board.setLastMove(null, null);
  board.disableInteraction();
  board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  moveList.loadPgn(null);
  evalChart.setData([], []);
  if (analysisSummary) { analysisSummary.innerHTML = ''; analysisSummary.classList.add('hidden'); }
  if (progressContainer) progressContainer.classList.add('hidden');

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

  if (!pendingScanData?.pgn && lobbyStatus.textContent === 'Scanning...') {
    lobbyStatus.textContent = 'No completed game found on this page.';
  }
}

function receiveScanResult(payload) {
  if (currentMode !== 'lobby') return;
  const { mode, pgn, metadata } = payload;
  if (mode === 'analysis' && pgn) {
    pendingScanData = { pgn, metadata };
    lobbyImportBtn.disabled = false;
    lobbyStatus.textContent = 'Completed game found! Click Import to analyze.';
  } else if (mode === 'live_helper') {
    pendingScanData = null;
    lobbyImportBtn.disabled = true;
    lobbyStatus.textContent = 'Game in progress. Analysis available after the game ends.';
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
// LOAD & ANALYZE GAME
// ============================================================

async function loadGame(pgn, detectedColor) {
  if (!pgn) return;
  if (!isGameComplete(pgn)) return;

  fullAnalysisCancelled = true;
  fullAnalysisRunning = true;
  currentPgn = pgn;
  gameClassifications = null;
  playerColor = detectedColor || 'white';
  setMode('analysis');

  if (analysisSummary) analysisSummary.classList.add('hidden');
  if (progressContainer) progressContainer.classList.add('hidden');
  scheduleBoardRedraw();
  board.clearDrawShapes();
  moveList.loadPgn(pgn);
  moveList.setPlayerColor(playerColor);
  board.setOrientation(playerColor);
  board.enableInteraction();
  evalBar.setFlipped(playerColor === 'black');
  evalChart.setFlipped(playerColor === 'black');
  evalChart.setPlayerColor(playerColor);

  await runFullGameAnalysis();
}

async function startSandbox() {
  fullAnalysisCancelled = true;
  fullAnalysisRunning = false;
  currentPgn = null;
  gameClassifications = null;
  playerColor = 'white';
  setMode('analysis');

  board.clearDrawShapes();
  moveList.loadStartingPosition();
  moveList.setPlayerColor(playerColor);
  board.setOrientation(playerColor);
  board.enableInteraction();
  evalBar.setFlipped(false);
  evalChart.setFlipped(false);
  evalChart.setPlayerColor(playerColor);
  evalChart.setData([], []);
  if (analysisSummary) { analysisSummary.innerHTML = ''; analysisSummary.classList.add('hidden'); }
  if (progressContainer) progressContainer.classList.add('hidden');
  scheduleBoardRedraw();

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  board.setPosition(startFen);
  board.setLastMove(null, null);
  analyzePosition(startFen);
}

async function runFullGameAnalysis() {
  if (!engine) await initEngine();
  if (!engine?.isReady()) {
    await new Promise(r => setTimeout(r, 2000));
    if (!engine) await initEngine();
    if (!engine?.isReady()) return;
  }

  const positions = moveList.getAllPositions();
  if (positions.length < 2) return;

  fullAnalysisCancelled = false;
  fullAnalysisRunning = true;
  if (progressContainer) progressContainer.classList.remove('hidden');
  if (analysisSummary) analysisSummary.classList.add('hidden');
  scheduleBoardRedraw();

  const partialClassifications = [null]; // accumulates as analysis progresses

  gameClassifications = await analyzeGame(positions, engine, {
    depth: 16,
    onProgress(current, total) {
      if (progressBar) progressBar.style.width = (total > 0 ? (current / total) * 100 : 0) + '%';
      if (progressText) progressText.textContent = `Analyzing: ${current}/${total} positions...`;
    },
    onMoveAnalyzed(ply, cls) {
      // Accumulate classifications incrementally
      while (partialClassifications.length <= ply) partialClassifications.push(null);
      partialClassifications[ply] = cls;

      // Incrementally colorize/classify the move in the move list
      moveList.updateClassification(ply, cls);

      // Incrementally build eval chart (grows as analysis progresses)
      evalChart.setData(partialClassifications, positions.slice(0, ply + 1));
      evalChart.setCurrentPly(moveList.getCurrentPly());

      // If user is viewing this ply, update board annotations and eval bar
      if (moveList.getCurrentPly() === ply && !moveList.isInHypothetical()) {
        showBoardAnnotations(ply, cls);
        evalBar.update({ type: 'cp', value: cls.evalAfter });
      }
    },
    onComplete(classifications) {
      fullAnalysisRunning = false;
      if (progressContainer) progressContainer.classList.add('hidden');
      moveList.setClassifications(classifications);
      gameClassifications = classifications;
      showAnalysisSummary(classifications);
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
    isCancelled: () => fullAnalysisCancelled,
  });
}

// ============================================================
// ANALYSIS SUMMARY
// ============================================================

function showAnalysisSummary(classifications) {
  if (!analysisSummary) return;
  const counts = { best: 0, excellent: 0, good: 0, book: 0, forced: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (let ply = 1; ply < classifications.length; ply++) {
    if (!isMyMove(ply)) continue;
    const cls = classifications[ply];
    if (cls && counts[cls.classification] !== undefined) counts[cls.classification]++;
  }
  const items = [
    { key: 'best', label: CLASS_SYMBOL.best },
    { key: 'excellent', label: CLASS_SYMBOL.excellent },
    { key: 'good', label: CLASS_SYMBOL.good },
    { key: 'inaccuracy', label: CLASS_SYMBOL.inaccuracy },
    { key: 'mistake', label: CLASS_SYMBOL.mistake },
    { key: 'blunder', label: CLASS_SYMBOL.blunder },
  ];
  const accuracy = gameAccuracy(classifications, isMyMove);
  analysisSummary.innerHTML = `<div class="summary-row">
    <span class="summary-item summary-accuracy" title="Accuracy (Lichess formula)">${accuracy.toFixed(1)}%</span>
    ${items.map(({ key, label }) =>
      `<span class="summary-item summary-${key}" title="${key}"><span class="summary-icon">${label}</span> ${counts[key]}</span>`
    ).join('')}
  </div>`;
  analysisSummary.classList.remove('hidden');
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
  return { best: '#96bc4b', excellent: '#96bc4b', good: '#97af8b', book: '#a88865', forced: '#999', inaccuracy: '#f7c631', mistake: '#e69a28', blunder: '#ca3431' }[cls] || '#999';
}

function makeClassificationSvg(symbol, color) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="85" cy="15" r="16" fill="${color}" opacity="0.9"/>
    <text x="85" y="15" text-anchor="middle" dominant-baseline="central"
          font-size="18" font-weight="bold" fill="white" font-family="sans-serif">${symbol}</text>
  </svg>`;
}

let hypoBestAlternative = null;

function showHypoBestMoveArrow() {
  if (!controls.isEngineOn() || !hypoBestAlternative?.length) { board.clearAutoShapes(); return; }
  const sq = uciSquares(hypoBestAlternative);
  board.setAutoShapes([{ orig: sq.from, dest: sq.to, brush: 'lightblue' }]);
}

// ============================================================
// ENGINE
// ============================================================

async function initEngine() {
  if (engine) return;
  engine = createStockfishController({
    onInfo(info) {
      const blackToMove = currentAnalysisFen?.split(' ')[1] === 'b';
      if (blackToMove && info.score) info.score = { type: info.score.type, value: -info.score.value };
      engineLines.updateLine(info);
      const bestEval = engineLines.getBestEval();
      if (bestEval) evalBar.update(bestEval);
    },
    onBestMove() { engineLines.setFinalized(); },
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
      // Live game detected in any tab — switch regardless of current mode
      if (currentMode !== 'live_helper') {
        handleLiveGameDetected(payload);
      }
    } else if (currentMode === 'live_helper') {
      // We are in live mode — check if the tracked live game has ended
      if (!liveGameTabId || payload.tabId === liveGameTabId) {
        handleLiveGameEnded(payload);
      }
    } else if (currentMode === 'lobby') {
      receiveScanResult(payload);
    }
  } else if (message.type === MSG.CLOCK_UPDATE && currentMode === 'live_helper') {
    liveHelper.updateClocks(message.payload);
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

/**
 * A live game was detected in some tab. Save current analysis (if any)
 * and switch to the live-helper view.
 */
function handleLiveGameDetected(payload) {
  liveGameTabId = payload.tabId || null;

  // Save analysis state so we can restore it after the game
  if (currentMode === 'analysis' && currentPgn) {
    savedAnalysisState = {
      pgn: currentPgn,
      playerColor,
      gameClassifications,
      currentPly: moveList.getCurrentPly(),
    };
    fullAnalysisCancelled = true;
    fullAnalysisRunning = false;
    if (engine) engine.stop();
  } else {
    savedAnalysisState = null;
  }

  setMode('live_helper');
  liveHelper.setMetadata(payload.metadata);
}

/**
 * The tracked live game ended (or its tab closed).
 * Restore the previous analysis state or fall back to the lobby.
 */
function handleLiveGameEnded(payload) {
  liveGameTabId = null;

  if (savedAnalysisState) {
    restoreAnalysisState(savedAnalysisState);
    savedAnalysisState = null;
  } else {
    setMode('lobby');
    receiveScanResult(payload);
  }
}

/**
 * Rebuild the analysis view from a previously-saved snapshot.
 */
function restoreAnalysisState(state) {
  currentPgn = state.pgn;
  playerColor = state.playerColor;
  fullAnalysisCancelled = false;
  fullAnalysisRunning = false;

  setMode('analysis');

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
  }

  if (state.currentPly > 0) moveList.goToMove(state.currentPly);

  const pos = moveList.getPosition(moveList.getCurrentPly());
  if (pos) analyzePosition(pos.fen);
}
