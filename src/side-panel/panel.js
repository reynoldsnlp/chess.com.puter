// chess.com.puter side panel entry point.
// Wires together the board, move list, eval bar, engine lines, controls, and PGN input.
// Handles mode switching between analysis (completed games) and live helper (active games).

import { MSG } from '../shared/messages.js';
import { isGameComplete } from '../shared/gameStatus.js';
import { createBoard } from './components/board.js';
import { createMoveList } from './components/moveList.js';
import { createEvalBar } from './components/evalBar.js';
import { createEngineLines } from './components/engineLines.js';
import { createControls } from './components/controls.js';
import { createPgnInput } from './components/pgnInput.js';
import { createLiveHelper } from './live-helper/liveHelper.js';
import { createStockfishController } from './engine/stockfishController.js';

// --- State ---
let currentPgn = null;
let currentMode = 'idle'; // 'idle' | 'analysis' | 'live_helper'
let engine = null;

// --- DOM References ---
const analysisSection = document.getElementById('analysis-section');
const liveSection = document.getElementById('live-section');
const statusMessage = document.getElementById('status-message');
const statusBar = document.getElementById('status-bar');

// --- Initialize Components ---
const board = createBoard(document.getElementById('board-container'));
const evalBar = createEvalBar(document.getElementById('eval-bar'));

const moveList = createMoveList(document.getElementById('move-list'), (ply, fen) => {
  board.setPosition(fen);
  evalBar.reset();
  engineLines.clear();
  engineLines.setFen(fen);
  analyzePosition(fen);
});

const engineLines = createEngineLines(document.getElementById('engine-lines'));

const controls = createControls(document.getElementById('control-bar'), {
  onDepthChange: (depth) => {
    // Restart analysis at the new depth
    const pos = moveList.getPosition(moveList.getCurrentPly());
    if (pos && engine?.isReady()) {
      engineLines.clear();
      engine.analyze(pos.fen, depth);
    }
  },
  onMultiPvChange: (multiPv) => {
    if (engine?.isReady()) {
      engine.setMultiPV(multiPv);
      // Re-analyze with new MultiPV
      const pos = moveList.getPosition(moveList.getCurrentPly());
      if (pos) {
        engineLines.clear();
        engine.analyze(pos.fen, controls.getDepth());
      }
    }
  },
  onFlip: () => board.flip(),
  onEngineToggle: (enabled) => {
    if (!enabled && engine) {
      engine.stop();
      engineLines.clear();
      evalBar.reset();
    } else if (enabled) {
      const pos = moveList.getPosition(moveList.getCurrentPly());
      if (pos) analyzePosition(pos.fen);
    }
  },
  onGoStart: () => moveList.goToStart(),
  onGoBack: () => moveList.goBack(),
  onGoForward: () => moveList.goForward(),
  onGoEnd: () => moveList.goToEnd(),
  getCurrentPgn: () => currentPgn,
});

const pgnInput = createPgnInput(document.getElementById('pgn-input'), (pgn) => {
  loadGame(pgn);
});

const liveHelper = createLiveHelper(document.getElementById('live-section'));

// --- Mode Switching ---

function setMode(mode) {
  currentMode = mode;

  // Show/hide sections
  if (analysisSection) analysisSection.hidden = mode !== 'analysis';
  if (liveSection) liveSection.hidden = mode !== 'live_helper';
  if (statusMessage) statusMessage.hidden = mode !== 'idle';

  // Update status bar
  if (statusBar) {
    statusBar.querySelector('.status-text').textContent =
      mode === 'analysis' ? 'Free the fish!' :
      mode === 'live_helper' ? 'Game in progress' :
      'Free the fish!';
  }
}

// --- Load a completed game ---

function loadGame(pgn) {
  if (!pgn) return;

  // Defense in depth: verify game completion
  if (!isGameComplete(pgn)) {
    setMode('live_helper');
    return;
  }

  currentPgn = pgn;
  setMode('analysis');

  // Load into move list (which also updates the board)
  moveList.loadPgn(pgn);
}

// --- Engine Initialization ---

async function initEngine() {
  if (engine) return;

  engine = createStockfishController({
    onInfo(info) {
      engineLines.updateLine(info);
      // Update eval bar with the best line's score
      const bestEval = engineLines.getBestEval();
      if (bestEval) evalBar.update(bestEval);
    },
    onBestMove(bm) {
      // Analysis complete for this position
    },
    onStatus(status) {
      const statusText = statusBar?.querySelector('.status-text');
      if (statusText && status.state === 'analyzing') {
        const npsStr = status.nps ? ` | ${(status.nps / 1e6).toFixed(1)} MN/s` : '';
        statusText.textContent = `SF 18 | d${status.depth}${npsStr} | Free the fish!`;
      } else if (statusText && status.state === 'ready') {
        statusText.textContent = 'Free the fish!';
      } else if (statusText) {
        statusText.textContent = status.text;
      }
    },
  });

  await engine.init();

  // Set initial MultiPV
  if (engine.isReady()) {
    engine.setMultiPV(controls.getMultiPv());
  }
}

// --- Engine Analysis ---

async function analyzePosition(fen) {
  if (!controls.isEngineOn()) return;
  if (currentMode !== 'analysis') return;

  engineLines.setFen(fen);

  // Lazily initialize engine on first analysis
  if (!engine) {
    await initEngine();
  }

  if (engine?.isReady()) {
    engine.analyze(fen, controls.getDepth());
  }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case MSG.GAME_DATA:
      handleGameData(message.payload);
      break;

    case MSG.CLOCK_UPDATE:
      if (currentMode === 'live_helper') {
        liveHelper.updateClocks(message.payload);
      }
      break;
  }
});

function handleGameData(payload) {
  const { mode, pgn, metadata } = payload;

  if (mode === 'analysis' && pgn) {
    loadGame(pgn);
  } else if (mode === 'live_helper') {
    setMode('live_helper');
    liveHelper.setMetadata(metadata);
  } else {
    setMode('idle');
  }
}

// --- Startup ---

// Request current game data from service worker
chrome.runtime.sendMessage({ type: MSG.REQUEST_GAME }, (response) => {
  if (response?.payload) {
    handleGameData(response.payload);
  }
});

// Default to idle mode
setMode('idle');
