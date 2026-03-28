// Controls bar component.
// Depth, multi-PV, navigation, flip, Open in Lichess, engine toggle.

import { MSG } from '../../shared/messages.js';
import { DEFAULT_DEPTH, DEFAULT_MULTI_PV, MAX_DEPTH, MAX_MULTI_PV, LICHESS_ANALYSIS_URL } from '../../shared/constants.js';

/**
 * @param {HTMLElement} container
 * @param {object} callbacks
 * @param {(depth: number) => void} callbacks.onDepthChange
 * @param {(multiPv: number) => void} callbacks.onMultiPvChange
 * @param {() => void} callbacks.onFlip
 * @param {(enabled: boolean) => void} callbacks.onEngineToggle
 * @param {() => void} callbacks.onGoStart
 * @param {() => void} callbacks.onGoBack
 * @param {() => void} callbacks.onGoForward
 * @param {() => void} callbacks.onGoEnd
 * @param {() => string} callbacks.getCurrentPgn - returns current PGN for Open in Lichess
 */
export function createControls(container, callbacks) {
  let depth = DEFAULT_DEPTH;
  let multiPv = DEFAULT_MULTI_PV;
  let engineOn = true;

  // Load saved preferences
  chrome.storage?.local?.get(['depth', 'multiPv'], (result) => {
    if (result.depth) { depth = result.depth; depthValue.textContent = depth; }
    if (result.multiPv) { multiPv = result.multiPv; pvValue.textContent = multiPv; }
  });

  container.innerHTML = `
    <div class="controls-nav">
      <button class="ctrl-btn" id="btn-start" title="Go to start">&laquo;</button>
      <button class="ctrl-btn" id="btn-back" title="Previous move">&lsaquo;</button>
      <button class="ctrl-btn" id="btn-forward" title="Next move">&rsaquo;</button>
      <button class="ctrl-btn" id="btn-end" title="Go to end">&raquo;</button>
    </div>
    <div class="controls-settings">
      <div class="control-group">
        <label>Depth</label>
        <button class="ctrl-btn ctrl-sm" id="btn-depth-down">&minus;</button>
        <span id="depth-value">${depth}</span>
        <button class="ctrl-btn ctrl-sm" id="btn-depth-up">&plus;</button>
      </div>
      <div class="control-group">
        <label>Lines</label>
        <button class="ctrl-btn ctrl-sm" id="btn-pv-down">&minus;</button>
        <span id="pv-value">${multiPv}</span>
        <button class="ctrl-btn ctrl-sm" id="btn-pv-up">&plus;</button>
      </div>
    </div>
    <div class="controls-actions">
      <button class="ctrl-btn" id="btn-lichess" title="Open in Lichess">Open in Lichess</button>
      <button class="ctrl-btn" id="btn-flip" title="Flip board">Flip</button>
      <button class="ctrl-btn" id="btn-engine" title="Toggle engine">Engine: ON</button>
    </div>
  `;

  const depthValue = container.querySelector('#depth-value');
  const pvValue = container.querySelector('#pv-value');
  const engineBtn = container.querySelector('#btn-engine');

  // Navigation
  container.querySelector('#btn-start').addEventListener('click', () => callbacks.onGoStart());
  container.querySelector('#btn-back').addEventListener('click', () => callbacks.onGoBack());
  container.querySelector('#btn-forward').addEventListener('click', () => callbacks.onGoForward());
  container.querySelector('#btn-end').addEventListener('click', () => callbacks.onGoEnd());

  // Depth
  container.querySelector('#btn-depth-down').addEventListener('click', () => {
    depth = Math.max(1, depth - 5);
    depthValue.textContent = depth;
    savePrefs();
    callbacks.onDepthChange(depth);
  });
  container.querySelector('#btn-depth-up').addEventListener('click', () => {
    depth = Math.min(MAX_DEPTH, depth + 5);
    depthValue.textContent = depth;
    savePrefs();
    callbacks.onDepthChange(depth);
  });

  // Multi-PV
  container.querySelector('#btn-pv-down').addEventListener('click', () => {
    multiPv = Math.max(1, multiPv - 1);
    pvValue.textContent = multiPv;
    savePrefs();
    callbacks.onMultiPvChange(multiPv);
  });
  container.querySelector('#btn-pv-up').addEventListener('click', () => {
    multiPv = Math.min(MAX_MULTI_PV, multiPv + 1);
    pvValue.textContent = multiPv;
    savePrefs();
    callbacks.onMultiPvChange(multiPv);
  });

  // Open in Lichess
  container.querySelector('#btn-lichess').addEventListener('click', () => {
    const pgn = callbacks.getCurrentPgn?.() || '';
    // Extract just the movetext (strip headers)
    const movetext = pgn.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
    const encoded = movetext.replace(/ /g, '_');
    const url = `${LICHESS_ANALYSIS_URL}/pgn/${encoded}`;
    chrome.runtime.sendMessage({ type: MSG.OPEN_IN_LICHESS, payload: { url } });
  });

  // Flip
  container.querySelector('#btn-flip').addEventListener('click', () => callbacks.onFlip());

  // Engine toggle
  container.querySelector('#btn-engine').addEventListener('click', () => {
    engineOn = !engineOn;
    engineBtn.textContent = engineOn ? 'Engine: ON' : 'Engine: OFF';
    engineBtn.classList.toggle('engine-off', !engineOn);
    callbacks.onEngineToggle(engineOn);
  });

  function savePrefs() {
    chrome.storage?.local?.set({ depth, multiPv });
  }

  return {
    getDepth: () => depth,
    getMultiPv: () => multiPv,
    isEngineOn: () => engineOn,
  };
}
