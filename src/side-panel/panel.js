// chess.com.puter side panel entry point.
// Full game analysis with chess.com Expected Points classification.
// UI focused on the detected player's moves.

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';
import { uciSquares } from '../shared/chessUtils.js';
import { createBoard } from './components/board.js';
import { createMoveList } from './components/moveList.js';
import { createEvalBar } from './components/evalBar.js';
import { createEngineLines } from './components/engineLines.js';
import { createControls } from './components/controls.js';
import { createPgnInput } from './components/pgnInput.js';
import { createLiveHelper } from './live-helper/liveHelper.js';
import { createStockfishController } from './engine/stockfishController.js';
import { analyzeGame } from './engine/gameAnalyzer.js';

// Classification symbols
const CLASS_SYMBOL = {
  best: '★', excellent: '+', good: '✔', book: '📖', forced: '→',
  inaccuracy: '?!', mistake: '?', blunder: '??',
};

// --- State ---
let currentPgn = null;
let currentMode = 'idle';
let engine = null;
let currentAnalysisFen = null;
let gameClassifications = null;
let fullAnalysisCancelled = false;
let playerColor = 'white';
let pendingGameData = null; // stores game data received before panel is ready

// --- DOM References ---
const analysisSection = document.getElementById('analysis-section');
const liveSection = document.getElementById('live-section');
const statusMessage = document.getElementById('status-message');
const statusBar = document.getElementById('status-bar');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const analysisSummary = document.getElementById('analysis-summary');

// --- Initialize Components ---
const board = createBoard(document.getElementById('board-container'));
const evalBar = createEvalBar(document.getElementById('eval-bar'));

const moveList = createMoveList(document.getElementById('move-list'), (ply, fen, classification) => {
  board.setPosition(fen);
  currentAnalysisFen = fen;

  // Highlight from-to squares (with castling normalization)
  if (ply > 0) {
    const pos = moveList.getPosition(ply);
    if (pos?.uci) {
      const sq = uciSquares(pos.uci);
      board.setLastMove(sq.from, sq.to);
    }
  } else {
    board.setLastMove(null, null);
  }

  showBoardAnnotations(ply, classification);

  if (classification) {
    evalBar.update({ type: 'cp', value: classification.evalAfter });
  } else {
    evalBar.reset();
  }

  engineLines.clear();
  engineLines.setFen(fen);
  analyzePosition(fen);
});

const engineLines = createEngineLines(document.getElementById('engine-lines'));

const controls = createControls(document.getElementById('control-bar'), {
  onDepthChange: (depth) => {
    const pos = moveList.getPosition(moveList.getCurrentPly());
    if (pos && engine?.isReady()) { engineLines.clear(); engine.analyze(pos.fen, depth); }
  },
  onMultiPvChange: (multiPv) => {
    if (engine?.isReady()) {
      engine.setMultiPV(multiPv);
      const pos = moveList.getPosition(moveList.getCurrentPly());
      if (pos) { engineLines.clear(); engine.analyze(pos.fen, controls.getDepth()); }
    }
  },
  onFlip: () => {
    board.flip();
    playerColor = playerColor === 'white' ? 'black' : 'white';
    evalBar.setFlipped(playerColor === 'black');
    moveList.setPlayerColor(playerColor);
    if (gameClassifications) showAnalysisSummary(gameClassifications);
  },
  onEngineToggle: (enabled) => {
    if (!enabled && engine) { engine.stop(); engineLines.clear(); evalBar.reset(); board.clearAutoShapes(); }
    else if (enabled) { const pos = moveList.getPosition(moveList.getCurrentPly()); if (pos) analyzePosition(pos.fen); }
  },
  onGoStart: () => moveList.goToStart(),
  onGoBack: () => moveList.goBack(),
  onGoForward: () => moveList.goForward(),
  onGoEnd: () => moveList.goToEnd(),
  getCurrentPgn: () => currentPgn,
});

const pgnInput = createPgnInput(document.getElementById('pgn-input'), (pgn) => {
  loadGame(pgn, 'white');
});

const liveHelper = createLiveHelper(document.getElementById('live-section'));

// --- Mode Switching ---

function setMode(mode) {
  currentMode = mode;
  if (analysisSection) analysisSection.hidden = mode !== 'analysis';
  if (liveSection) liveSection.hidden = mode !== 'live_helper';
  if (statusMessage) statusMessage.hidden = mode !== 'idle';
  if (statusBar) {
    statusBar.querySelector('.status-text').textContent =
      mode === 'analysis' ? 'Free the fish!' :
      mode === 'live_helper' ? 'Game in progress' : 'Free the fish!';
  }
}

// --- Player detection ---

function isMyMove(ply) {
  return playerColor === 'white' ? ply % 2 === 1 : ply % 2 === 0;
}

// --- Load a completed game ---

async function loadGame(pgn, detectedColor) {
  if (!pgn) return;
  if (!isGameComplete(pgn)) { setMode('live_helper'); return; }

  fullAnalysisCancelled = true;
  currentPgn = pgn;
  gameClassifications = null;
  playerColor = detectedColor || 'white';
  setMode('analysis');

  moveList.loadPgn(pgn);
  moveList.setPlayerColor(playerColor);
  evalBar.setFlipped(playerColor === 'black');

  // Auto-run full game analysis
  await runFullGameAnalysis();
}

// --- Full Game Analysis ---

async function runFullGameAnalysis() {
  // Ensure engine is initialized
  if (!engine) await initEngine();
  // Retry if engine didn't initialize (e.g., WASM still loading)
  if (!engine?.isReady()) {
    console.log('chess.com.puter: engine not ready, retrying in 2s...');
    await new Promise(r => setTimeout(r, 2000));
    if (!engine) await initEngine();
    if (!engine?.isReady()) {
      console.error('chess.com.puter: engine failed to initialize');
      return;
    }
  }

  const positions = moveList.getAllPositions();
  if (positions.length < 2) return;

  fullAnalysisCancelled = false;
  if (progressContainer) progressContainer.hidden = false;
  if (analysisSummary) analysisSummary.hidden = true;

  gameClassifications = await analyzeGame(positions, engine, {
    depth: 16,
    onProgress(current, total) {
      if (progressBar) progressBar.style.width = (total > 0 ? (current / total) * 100 : 0) + '%';
      if (progressText) progressText.textContent = `Analyzing: ${current}/${total} positions...`;
    },
    onComplete(classifications) {
      if (progressContainer) progressContainer.hidden = true;
      moveList.setClassifications(classifications);
      gameClassifications = classifications;
      showAnalysisSummary(classifications);
      engine.setMultiPV(controls.getMultiPv());
      const ply = moveList.getCurrentPly();
      showBoardAnnotations(ply, moveList.getClassification(ply));
    },
    isCancelled: () => fullAnalysisCancelled,
  });
}

// --- Analysis Summary (my moves only, with symbols) ---

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

  analysisSummary.innerHTML = `<div class="summary-row">${
    items.map(({ key, label }) =>
      `<span class="summary-item summary-${key}" title="${key}"><span class="summary-icon">${label}</span> ${counts[key]}</span>`
    ).join('')
  }</div>`;
  analysisSummary.hidden = false;
}

// --- Board Annotations (arrows + classification icon) ---

function showBoardAnnotations(ply, classification) {
  if (!controls.isEngineOn()) { board.clearAutoShapes(); return; }

  const shapes = [];

  // Green arrow for engine's best move
  if (classification?.engineBestMove?.length >= 4) {
    const sq = uciSquares(classification.engineBestMove);
    shapes.push({ orig: sq.from, dest: sq.to, brush: 'green' });
  }

  // Classification icon on the king's destination square (handles castling)
  if (ply > 0 && classification) {
    const pos = moveList.getPosition(ply);
    if (pos?.uci) {
      const sq = uciSquares(pos.uci);
      const symbol = CLASS_SYMBOL[classification.classification];
      const color = classificationColor(classification.classification);
      if (symbol && sq.to) {
        shapes.push({
          orig: sq.to,
          customSvg: { html: makeClassificationSvg(symbol, color) },
        });
      }
    }
  }

  board.setAutoShapes(shapes);
}

function classificationColor(cls) {
  const colors = {
    best: '#96bc4b', excellent: '#96bc4b', good: '#97af8b', book: '#a88865',
    forced: '#999', inaccuracy: '#f7c631', mistake: '#e69a28', blunder: '#ca3431',
  };
  return colors[cls] || '#999';
}

function makeClassificationSvg(symbol, color) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="85" cy="15" r="16" fill="${color}" opacity="0.9"/>
    <text x="85" y="15" text-anchor="middle" dominant-baseline="central"
          font-size="18" font-weight="bold" fill="white" font-family="sans-serif">${symbol}</text>
  </svg>`;
}

// --- Engine Initialization ---

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
    onBestMove() {},
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

// --- Live Engine Analysis ---

async function analyzePosition(fen) {
  if (!controls.isEngineOn() || currentMode !== 'analysis') return;
  currentAnalysisFen = fen;
  engineLines.setFen(fen);
  if (!engine) await initEngine();
  if (engine?.isReady()) engine.analyze(fen, controls.getDepth());
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.GAME_DATA) handleGameData(message.payload);
  else if (message.type === MSG.CLOCK_UPDATE && currentMode === 'live_helper') liveHelper.updateClocks(message.payload);
});

function handleGameData(payload) {
  const { mode, pgn, metadata } = payload;
  if (mode === 'analysis' && pgn) {
    const color = metadata?.playerColor || 'white';
    loadGame(pgn, color);
  } else if (mode === 'live_helper') {
    setMode('live_helper');
    liveHelper.setMetadata(metadata);
  } else {
    setMode('idle');
  }
}

// --- Startup (robust initialization with retry) ---

async function startup() {
  // Request game data from service worker
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME });
    if (response?.payload) {
      handleGameData(response.payload);
      return;
    }
  } catch (e) {
    // Service worker might not be ready yet
  }

  // Retry after a delay — content script or service worker may not be ready
  setTimeout(async () => {
    if (currentMode !== 'idle') return; // Already loaded something
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME });
      if (response?.payload) handleGameData(response.payload);
    } catch (e) {
      // Still not ready, but incoming GAME_DATA messages will handle it
    }
  }, 2000);

  // Another retry at 5s for slow-loading pages
  setTimeout(async () => {
    if (currentMode !== 'idle') return;
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME });
      if (response?.payload) handleGameData(response.payload);
    } catch (e) {}
  }, 5000);
}

setMode('idle');
startup();
