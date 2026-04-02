// Stockfish WASM controller.
// Manages the engine lifecycle and UCI protocol.

import { parseInfoLine, parseBestMove } from './uciParser.js';

export function createStockfishController(callbacks) {
  let sf = null;
  let ready = false;
  let messageWaiters = [];

  // When in batch mode (full game analysis), these intercept engine output
  let batchInfoHandler = null;
  let batchBestMoveHandler = null;

  const ctrl = {
    async init() {
      if (sf) return;
      try {
        callbacks.onStatus?.({ state: 'loading', text: 'Loading Stockfish...' });
        const sfUrl = chrome.runtime.getURL('stockfish/sf_18_smallnet.js');
        const module = await import(sfUrl);
        const Factory = module.default || Object.values(module)[0];
        if (typeof Factory !== 'function') throw new Error('Stockfish factory not found');

        sf = await Factory({
          listen(line) { handleMessage(line); },
          onError(err) { console.error('Stockfish error:', err); },
        });

        sf.uci('uci');
        await waitForToken('uciok');

        // Load the NNUE neural network (required for evaluation)
        const nnueName = sf.getRecommendedNnue(0);
        console.log('chess.com.puter: recommended NNUE:', nnueName);

        if (nnueName) {
          callbacks.onStatus?.({ state: 'loading', text: 'Loading NNUE...' });
          try {
            const nnueUrl = chrome.runtime.getURL(`stockfish/${nnueName}`);
            const resp = await fetch(nnueUrl);
            if (!resp.ok) throw new Error(`Failed to fetch NNUE: ${resp.status}`);
            const buf = new Uint8Array(await resp.arrayBuffer());
            sf.setNnueBuffer(buf, 0);
            console.log(`chess.com.puter: loaded NNUE ${nnueName} (${(buf.length / 1024).toFixed(0)} KB)`);
          } catch (err) {
            console.error('chess.com.puter: NNUE load failed:', err);
            console.error('Run "npm run postinstall" to download the NNUE file');
          }
        }

        sf.uci('isready');
        await waitForToken('readyok');
        ready = true;
        callbacks.onStatus?.({ state: 'ready', text: 'Stockfish ready' });
      } catch (err) {
        console.error('chess.com.puter: Failed to init Stockfish:', err);
        callbacks.onStatus?.({ state: 'error', text: `Engine error: ${err.message}` });
      }
    },

    analyze(fen, depth) {
      if (!sf || !ready) return;
      sf.uci('stop');
      sf.uci(`position fen ${fen}`);
      sf.uci(`go depth ${depth}`);
    },

    /**
     * Analyze a position and wait for the result. Used by full game analysis.
     * Returns { score, bestMove, pv }.
     */
    analyzeAndWait(fen, depth) {
      if (!sf || !ready) return Promise.resolve({ score: null, bestMove: '', pv: [] });

      return new Promise((resolve) => {
        let bestScore = null;
        let bestPv = [];

        // Set batch handlers to intercept output
        batchInfoHandler = (info) => {
          if (info.multipv === 1) {
            bestScore = info.score;
            bestPv = info.pv || [];
          }
        };

        batchBestMoveHandler = (bm) => {
          batchInfoHandler = null;
          batchBestMoveHandler = null;
          console.log('chess.com.puter analyzeAndWait result:', { score: bestScore, bestMove: bm.bestmove, pvFirst: bestPv?.[0] });
          resolve({ score: bestScore, bestMove: bm.bestmove, pv: bestPv });
        };

        // Send commands. Don't use stop here - just set position and go.
        // The previous analyzeAndWait already resolved via bestmove,
        // so the engine should be idle.
        sf.uci(`position fen ${fen}`);
        sf.uci(`go depth ${depth}`);
      });
    },

    /**
     * Stop current analysis and wait for the bestmove to drain.
     * Call before starting batch analysis to ensure clean state.
     */
    stopAndWait() {
      if (!sf || !ready) return Promise.resolve();
      return new Promise((resolve) => {
        // If engine is idle, stop won't produce bestmove. Use isready as sync point.
        sf.uci('stop');
        sf.uci('isready');
        waitForToken('readyok').then(resolve);
      });
    },

    stop() { if (sf && ready) sf.uci('stop'); },

    setMultiPV(n) {
      if (!sf || !ready) return;
      sf.uci('stop');
      sf.uci(`setoption name MultiPV value ${n}`);
    },

    isReady() { return ready; },

    destroy() { if (sf) { sf.uci('quit'); sf = null; ready = false; } },
  };

  function handleMessage(line) {
    if (typeof line !== 'string') return;

    // Log all raw engine output that contains score or bestmove
    if (line.includes('score') || line.startsWith('bestmove')) {
      console.log('chess.com.puter SF raw:', line);
    }

    // Check waiters (for init handshake and stopAndWait)
    for (let i = messageWaiters.length - 1; i >= 0; i--) {
      if (line.includes(messageWaiters[i].token)) {
        messageWaiters[i].resolve(line);
        messageWaiters.splice(i, 1);
      }
    }

    const info = parseInfoLine(line);
    if (line.includes('score') && !info) {
      console.warn('chess.com.puter: UCI parser returned null for line with score:', line);
    }
    if (info) {
      console.log('chess.com.puter SF parsed:', { depth: info.depth, score: info.score, multipv: info.multipv, pvFirst: info.pv?.[0] });
      if (batchInfoHandler) {
        batchInfoHandler(info);
      } else {
        callbacks.onInfo?.(info);
        callbacks.onStatus?.({
          state: 'analyzing', text: `depth ${info.depth}`,
          depth: info.depth, nps: info.nps,
        });
      }
      return;
    }

    const bm = parseBestMove(line);
    if (bm) {
      if (batchBestMoveHandler) {
        batchBestMoveHandler(bm);
      } else {
        callbacks.onBestMove?.(bm);
        callbacks.onStatus?.({ state: 'ready', text: 'Analysis complete' });
      }
    }
  }

  function waitForToken(token, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: ${token}`)), timeout);
      messageWaiters.push({
        token,
        resolve: (line) => { clearTimeout(timer); resolve(line); },
      });
    });
  }

  return ctrl;
}
