// Stockfish WASM controller.
// Manages the engine lifecycle and UCI protocol.

import { parseInfoLine, parseBestMove } from './uciParser.js';

/**
 * @param {object} callbacks
 * @param {(info: object) => void} callbacks.onInfo
 * @param {(bestmove: object) => void} callbacks.onBestMove
 * @param {(status: object) => void} callbacks.onStatus
 */
export function createStockfishController(callbacks) {
  let sf = null;
  let ready = false;
  let currentFen = null;
  let messageWaiters = [];

  async function init() {
    if (sf) return;

    try {
      callbacks.onStatus?.({ state: 'loading', text: 'Loading Stockfish...' });

      const sfUrl = chrome.runtime.getURL('stockfish/sf_18_smallnet.js');
      console.log('chess.com.puter: loading Stockfish from', sfUrl);

      // Dynamic import of the Emscripten module
      const module = await import(sfUrl);
      console.log('chess.com.puter: module loaded, exports:', Object.keys(module));

      // The Emscripten module exports the factory function.
      // Try `default` first, then look for named export.
      const StockfishFactory = module.default || module.Sf_18_Smallnet_Web || Object.values(module)[0];
      if (typeof StockfishFactory !== 'function') {
        throw new Error(`Stockfish factory is ${typeof StockfishFactory}, expected function. Exports: ${Object.keys(module)}`);
      }

      console.log('chess.com.puter: calling Stockfish factory...');
      sf = await StockfishFactory({
        listen(line) {
          handleMessage(line);
        },
        onError(err) {
          console.error('chess.com.puter Stockfish error:', err);
        },
      });
      console.log('chess.com.puter: Stockfish instance created, methods:', Object.keys(sf));

      // UCI initialization
      sf.uci('uci');
      await waitForMessage('uciok');
      console.log('chess.com.puter: got uciok');

      sf.uci('isready');
      await waitForMessage('readyok');
      console.log('chess.com.puter: got readyok, engine is ready');

      ready = true;
      callbacks.onStatus?.({ state: 'ready', text: 'Stockfish ready' });
    } catch (err) {
      console.error('chess.com.puter: Failed to initialize Stockfish:', err);
      callbacks.onStatus?.({ state: 'error', text: `Engine error: ${err.message}` });
    }
  }

  function handleMessage(line) {
    if (typeof line !== 'string') return;

    // Resolve any pending waiters
    for (let i = messageWaiters.length - 1; i >= 0; i--) {
      if (line.includes(messageWaiters[i].token)) {
        messageWaiters[i].resolve(line);
        messageWaiters.splice(i, 1);
      }
    }

    const info = parseInfoLine(line);
    if (info) {
      callbacks.onInfo?.(info);
      callbacks.onStatus?.({
        state: 'analyzing',
        text: `depth ${info.depth}`,
        depth: info.depth,
        nps: info.nps,
      });
      return;
    }

    const bm = parseBestMove(line);
    if (bm) {
      callbacks.onBestMove?.(bm);
      callbacks.onStatus?.({ state: 'ready', text: 'Analysis complete' });
    }
  }

  function waitForMessage(token, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for "${token}"`));
      }, timeout);

      messageWaiters.push({
        token,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
      });
    });
  }

  return {
    init,

    analyze(fen, depth) {
      if (!sf || !ready) {
        console.log('chess.com.puter: cannot analyze, engine not ready. sf:', !!sf, 'ready:', ready);
        return;
      }
      currentFen = fen;
      sf.uci('stop');
      sf.uci(`position fen ${fen}`);
      sf.uci(`go depth ${depth}`);
    },

    stop() {
      if (sf && ready) sf.uci('stop');
    },

    setMultiPV(n) {
      if (!sf || !ready) return;
      sf.uci('stop');
      sf.uci(`setoption name MultiPV value ${n}`);
    },

    isReady() { return ready; },

    destroy() {
      if (sf) {
        sf.uci('quit');
        sf = null;
        ready = false;
      }
    },
  };
}
