// Live helper mode coordinator.
// Shows non-evaluative tools during active games.
// NO engine analysis - anti-cheating by design.

const STORAGE_KEY = 'liveHelperMeterSettings';
const MIN_SLIDER_GAP = 0.06;
const LARGE_BASELINE_JUMP_SECONDS = 5;
const RENDER_INTERVAL_MS = 250;
const DEFAULT_SETTINGS = {
  totalWarn: 0.64,
  totalAlert: 0.82,
  moveWarn: 0.84,
  moveAlert: 0.68,
};

const CHECKLIST_SECTIONS = [
  {
    title: 'Forcing Moves',
    items: [
      {
        label: 'Checks first',
        tip: 'List every forcing check for both sides before you spend time on quiet candidate moves.',
      },
      {
        label: 'Captures that change the position',
        tip: 'Look for captures that win material, remove defenders, or open lines around a king.',
      },
      {
        label: 'Direct threats',
        tip: 'If there is no forcing move, identify the cleanest threat you can pose and the cleanest threat you must meet.',
      },
      {
        label: 'Mate net scan',
        tip: 'Look for forced checkmate motifs, back-rank ideas, smothered mates, and flight-square restrictions.',
      },
    ],
  },
  {
    title: 'Tactical Motifs',
    items: [
      {
        label: 'Pins',
        tip: 'Pinned pieces cannot move freely. Check whether a pin wins material or freezes a key defender.',
      },
      {
        label: 'Skewers',
        tip: 'Look through valuable pieces. If the front piece moves, what falls behind it?',
      },
      {
        label: 'Forks',
        tip: 'Search for single moves that hit two targets, especially king plus material or queen plus rook.',
      },
      {
        label: 'Discovered attacks',
        tip: 'Can moving one piece expose a rook, bishop, or queen attack on something more valuable?',
      },
      {
        label: 'Deflection and overload',
        tip: 'Ask whether one defender is doing too many jobs, then see if you can drag it away from one of them.',
      },
      {
        label: 'Loose pieces',
        tip: 'Loose pieces drop off. Mark every undefended or underdefended piece before you commit.',
      },
    ],
  },
  {
    title: 'Before You Move',
    items: [
      {
        label: 'Opponent best reply',
        tip: 'State your opponent\'s most annoying answer out loud before trusting your line.',
      },
      {
        label: 'Zwischenzug check',
        tip: 'Before recapturing or following your first instinct, look for an in-between move that improves the sequence.',
      },
      {
        label: 'King safety after the line',
        tip: 'When the smoke clears, make sure your own king is still safe and your back rank is not soft.',
      },
      {
        label: 'Final blunder check',
        tip: 'Right before moving, re-scan checks, captures, and threats from your opponent\'s side one last time.',
      },
    ],
  },
];

export function createLiveHelper(container) {
  const clock = createEmptyClockState();
  let metadata = null;
  let preferredPlayerColor = 'white';
  let settings = { ...DEFAULT_SETTINGS };
  let dragging = null;
  let destroyed = false;
  let active = false;
  let renderTimer = 0;
  let lastSummaryHtml = '';
  let sliderRenderDirty = true;

  container.innerHTML = `
    <div class="live-helper-shell">
      <section class="live-helper-hero">
        <h1>Become one with your inner fish</h1>
        <p class="live-helper-lead">Stockfish stays off during live play. Use the clocks to ration attention and the checklist to force cleaner calculation.</p>
        <div class="live-helper-summary" id="live-helper-summary">Waiting for live clock data from an active game.</div>
      </section>

      <div class="live-helper-body">
        <aside class="live-helper-rail">
          <section class="live-meter">
            <div class="live-meter-title" title="Your share of the total remaining clock.">Clock share</div>
            <div class="live-meter-track live-meter-track-share">
              <span class="live-meter-edge live-meter-edge-top">Them</span>
              <span class="live-meter-edge live-meter-edge-bottom">You</span>
              <div class="live-meter-midline"></div>
              <div class="live-meter-fill live-meter-fill-share" id="live-share-fill"></div>
              <div class="live-meter-head" id="live-share-head"></div>
            </div>
            <div class="live-meter-value" id="live-share-value">50 / 50</div>
            <div class="live-meter-detail" id="live-share-detail">You --:--  Them --:--</div>
          </section>

          <section class="live-meter">
            <div class="live-meter-title">Total time</div>
            <div class="live-meter-track live-meter-track-down" id="live-total-track">
              <div class="live-meter-fill live-meter-fill-down" id="live-total-fill"></div>
              <div class="live-meter-head" id="live-total-head"></div>
              <button type="button" class="live-meter-slider" data-track="total" data-handle="warn">!</button>
              <button type="button" class="live-meter-slider" data-track="total" data-handle="alert">!!</button>
            </div>
            <div class="live-meter-value" id="live-total-value">--:--</div>
            <div class="live-meter-detail" id="live-total-detail">! --  !! --</div>
          </section>

          <section class="live-meter">
            <div class="live-meter-title">Move time</div>
            <div class="live-meter-track live-meter-track-up" id="live-move-track">
              <div class="live-meter-fill live-meter-fill-up" id="live-move-fill"></div>
              <div class="live-meter-head" id="live-move-head"></div>
              <button type="button" class="live-meter-slider" data-track="move" data-handle="warn">!</button>
              <button type="button" class="live-meter-slider" data-track="move" data-handle="alert">!!</button>
            </div>
            <div class="live-meter-value" id="live-move-value">0s</div>
            <div class="live-meter-detail" id="live-move-detail">! 0%  !! 0%</div>
          </section>
        </aside>

        <main class="live-helper-main">
        <section class="live-helper-card">
          <div class="live-helper-card-header">
            <h2>Calculation Checklist</h2>
            <span class="live-helper-card-note">Hover or focus the <code>?</code> buttons for prompts.</span>
          </div>
          <div class="live-helper-checklist" id="live-helper-checklist">
            ${renderChecklistMarkup()}
          </div>
        </section>
        </main>
      </div>
    </div>
  `;

  const refs = {
    summary: container.querySelector('#live-helper-summary'),
    shareFill: container.querySelector('#live-share-fill'),
    shareHead: container.querySelector('#live-share-head'),
    shareValue: container.querySelector('#live-share-value'),
    shareDetail: container.querySelector('#live-share-detail'),
    totalTrack: container.querySelector('#live-total-track'),
    totalFill: container.querySelector('#live-total-fill'),
    totalHead: container.querySelector('#live-total-head'),
    totalValue: container.querySelector('#live-total-value'),
    totalDetail: container.querySelector('#live-total-detail'),
    moveTrack: container.querySelector('#live-move-track'),
    moveFill: container.querySelector('#live-move-fill'),
    moveHead: container.querySelector('#live-move-head'),
    moveValue: container.querySelector('#live-move-value'),
    moveDetail: container.querySelector('#live-move-detail'),
    sliders: Array.from(container.querySelectorAll('.live-meter-slider')),
  };

  for (const slider of refs.sliders) {
    slider.addEventListener('pointerdown', handleSliderPointerDown);
  }

  chrome.storage?.local?.get([STORAGE_KEY], (result) => {
    if (destroyed) return;
    const saved = result?.[STORAGE_KEY];
    if (!saved) return;
    settings = sanitizeSettings(saved);
    sliderRenderDirty = true;
    if (active) render(performance.now());
  });

  const pointerMoveListener = (event) => {
    if (!dragging) return;
    event.preventDefault();
    const trackEl = dragging.track === 'total' ? refs.totalTrack : refs.moveTrack;
    const rect = trackEl.getBoundingClientRect();
    const topRatio = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);

    if (dragging.track === 'total') {
      if (dragging.handle === 'warn') {
        settings.totalWarn = clamp(topRatio, 0.04, settings.totalAlert - MIN_SLIDER_GAP);
      } else {
        settings.totalAlert = clamp(topRatio, settings.totalWarn + MIN_SLIDER_GAP, 0.98);
      }
    } else if (dragging.handle === 'warn') {
      settings.moveWarn = clamp(topRatio, settings.moveAlert + MIN_SLIDER_GAP, 0.98);
    } else {
      settings.moveAlert = clamp(topRatio, 0.02, settings.moveWarn - MIN_SLIDER_GAP);
    }

    sliderRenderDirty = true;
    if (active) render(performance.now());
  };

  const pointerUpListener = () => {
    if (!dragging) return;
    dragging = null;
    syncRenderTimer();
    chrome.storage?.local?.set({ [STORAGE_KEY]: settings });
  };

  window.addEventListener('pointermove', pointerMoveListener);
  window.addEventListener('pointerup', pointerUpListener);
  window.addEventListener('pointercancel', pointerUpListener);

  function handleSliderPointerDown(event) {
    const slider = event.currentTarget;
    dragging = {
      track: slider.dataset.track,
      handle: slider.dataset.handle,
    };
    syncRenderTimer();
    event.preventDefault();
  }

  function reset(nextMetadata = null) {
    Object.assign(clock, createEmptyClockState());
    metadata = null;
    preferredPlayerColor = 'white';
    sliderRenderDirty = true;
    lastSummaryHtml = '';
    setMetadata(nextMetadata);
    syncRenderTimer();
  }

  function setMetadata(nextMetadata) {
    metadata = nextMetadata || null;
    if (metadata?.playerColor) preferredPlayerColor = metadata.playerColor;
    lastSummaryHtml = '';
    if (active) render(performance.now());
  }

  function updateClocks({ whiteTime, blackTime, playerColor }) {
    const whiteSecs = parseTimeToSeconds(whiteTime);
    const blackSecs = parseTimeToSeconds(blackTime);
    const now = performance.now();

    clock.whiteText = whiteTime || '--:--';
    clock.blackText = blackTime || '--:--';

    if (playerColor) preferredPlayerColor = playerColor;
    const myColor = metadata?.playerColor || preferredPlayerColor || 'white';

    if (whiteSecs === null || blackSecs === null) {
      if (active) render(now);
      return;
    }

    const mySecs = myColor === 'white' ? whiteSecs : blackSecs;
    const theirSecs = myColor === 'white' ? blackSecs : whiteSecs;
    const nextActiveClock = inferActiveClock(clock.mySecs, clock.theirSecs, mySecs, theirSecs, clock.activeClock);
    let baselineChanged = false;

    if (clock.originalMySecs === null || mySecs > clock.originalMySecs + LARGE_BASELINE_JUMP_SECONDS) {
      clock.originalMySecs = mySecs;
      baselineChanged = true;
    }
    if (clock.originalTheirSecs === null || theirSecs > clock.originalTheirSecs + LARGE_BASELINE_JUMP_SECONDS) {
      clock.originalTheirSecs = theirSecs;
      baselineChanged = true;
    }

    if (nextActiveClock === 'me' && clock.activeClock !== 'me') {
      clock.turnStartMySecs = mySecs;
    } else if (clock.activeClock === null && nextActiveClock === 'me' && clock.turnStartMySecs === null) {
      clock.turnStartMySecs = mySecs;
    }

    clock.activeClock = nextActiveClock;
    clock.mySecs = mySecs;
    clock.theirSecs = theirSecs;
    clock.lastSampleAt = now;

    if (baselineChanged) sliderRenderDirty = true;
    syncRenderTimer();
    if (active) render(now);
  }

  function render(now) {
    const myColor = metadata?.playerColor || preferredPlayerColor || 'white';
    const theirColor = myColor === 'white' ? 'black' : 'white';
    const myName = metadata?.[myColor]?.name || 'You';
    const theirName = metadata?.[theirColor]?.name || 'Opponent';
    const estimated = estimateClock(now, clock);

    renderSummary(now, myName, theirName, myColor, estimated);
    renderClockShare(estimated);
    renderTotalMeter(now, estimated);
    renderMoveMeter(now, estimated);
    if (sliderRenderDirty) renderSliderHandles();
  }

  function renderSummary(now, myName, theirName, myColor, estimated) {
    const theirColor = myColor === 'white' ? 'black' : 'white';
    const myFallback = myColor === 'white' ? clock.whiteText : clock.blackText;
    const theirFallback = theirColor === 'white' ? clock.whiteText : clock.blackText;
    const turnText = clock.activeClock === 'me'
      ? 'Your move'
      : clock.activeClock === 'them'
        ? 'Opponent move'
        : 'Waiting for clock changes';

    const parts = [
      `<span><strong>${escapeHtml(myName)}</strong> (${myColor})</span>`,
      `<span>${formatTimeOrFallback(estimated.mySecs, myFallback)}</span>`,
      `<span>vs</span>`,
      `<span><strong>${escapeHtml(theirName)}</strong></span>`,
      `<span>${formatTimeOrFallback(estimated.theirSecs, theirFallback)}</span>`,
      `<span>${turnText}</span>`,
    ];

    const html = parts.join(' ');
    if (html !== lastSummaryHtml) {
      refs.summary.innerHTML = html;
      lastSummaryHtml = html;
    }
  }

  function renderClockShare(estimated) {
    if (estimated.mySecs === null || estimated.theirSecs === null) {
      setStyle(refs.shareFill, 'top', '50%');
      setStyle(refs.shareFill, 'height', '0%');
      setStyle(refs.shareFill, 'background', 'transparent');
      setStyle(refs.shareHead, 'top', '50%');
      setStyle(refs.shareHead, 'background', 'transparent');
      setText(refs.shareValue, '50 / 50');
      const myColor = metadata?.playerColor || preferredPlayerColor || 'white';
      const theirColor = myColor === 'white' ? 'black' : 'white';
      const myFallback = myColor === 'white' ? clock.whiteText : clock.blackText;
      const theirFallback = theirColor === 'white' ? clock.whiteText : clock.blackText;
      setText(refs.shareDetail, `You ${myFallback}  Them ${theirFallback}`);
      return;
    }

    const total = Math.max(estimated.mySecs + estimated.theirSecs, 0.001);
    const share = clamp(estimated.mySecs / total, 0, 1);
    const top = Math.min(share, 0.5);
    const height = Math.abs(share - 0.5);
    const alpha = clamp(height / (1 / 6), 0, 1);
    const color = share >= 0.5
      ? rgba([98, 153, 36], alpha)
      : rgba([204, 51, 51], alpha);

    setStyle(refs.shareFill, 'top', `${top * 100}%`);
    setStyle(refs.shareFill, 'height', `${height * 100}%`);
    setStyle(refs.shareFill, 'background', color);
    setStyle(refs.shareHead, 'top', `${share * 100}%`);
    setStyle(refs.shareHead, 'background', alpha > 0 ? color : 'rgba(255, 255, 255, 0.28)');
    setText(refs.shareValue, `${Math.round(share * 100)} / ${Math.round((1 - share) * 100)}`);
    setText(refs.shareDetail, `You ${formatTimeOrFallback(estimated.mySecs, '--:--')}  Them ${formatTimeOrFallback(estimated.theirSecs, '--:--')}`);
  }

  function renderTotalMeter(now, estimated) {
    const baseline = clock.originalMySecs;
    if (estimated.mySecs === null || !baseline) {
      setStyle(refs.totalFill, 'height', '0%');
      setStyle(refs.totalFill, 'background', 'transparent');
      setStyle(refs.totalHead, 'top', '0%');
      setStyle(refs.totalHead, 'background', 'transparent');
      setText(refs.totalValue, '--:--');
      setText(refs.totalDetail, '! --  !! --');
      return;
    }

    const consumedRatio = clamp((baseline - estimated.mySecs) / Math.max(baseline, 0.001), 0, 1);
    const warnAlpha = clamp(Math.pow(consumedRatio / Math.max(settings.totalWarn, 0.001), 1.25), 0, 1);
    const blinkUrgency = consumedRatio >= settings.totalAlert
      ? clamp((consumedRatio - settings.totalAlert) / Math.max(1 - settings.totalAlert, 0.001), 0, 1)
      : 0;
    const alpha = warnAlpha * blinkPulse(now, blinkUrgency);
    const color = rgba([204, 51, 51], alpha);

    setStyle(refs.totalFill, 'height', `${consumedRatio * 100}%`);
    setStyle(refs.totalFill, 'background', color);
    setStyle(refs.totalHead, 'top', `${consumedRatio * 100}%`);
    setStyle(refs.totalHead, 'background', alpha > 0 ? color : 'rgba(255, 255, 255, 0.24)');
    setText(refs.totalValue, formatTimeOrFallback(estimated.mySecs, '--:--'));
    setText(refs.totalDetail, `! ${describeTotalThreshold(settings.totalWarn, baseline)}  !! ${describeTotalThreshold(settings.totalAlert, baseline)}`);
  }

  function renderMoveMeter(now, estimated) {
    const baseline = clock.originalMySecs;
    const onMyTurn = clock.activeClock === 'me';
    const elapsedOnMove = onMyTurn && estimated.mySecs !== null && clock.turnStartMySecs !== null
      ? Math.max(0, clock.turnStartMySecs - estimated.mySecs)
      : 0;
    const usedRatio = baseline ? clamp(elapsedOnMove / Math.max(baseline, 0.001), 0, 1) : 0;
    const warnUsedRatio = 1 - settings.moveWarn;
    const alertUsedRatio = 1 - settings.moveAlert;
    const warnAlpha = onMyTurn
      ? clamp(Math.pow(usedRatio / Math.max(warnUsedRatio, 0.001), 1.15), 0, 1)
      : 0;
    const blinkUrgency = onMyTurn && usedRatio >= alertUsedRatio
      ? clamp((usedRatio - alertUsedRatio) / Math.max(1 - alertUsedRatio, 0.001), 0, 1)
      : 0;
    const alpha = warnAlpha * blinkPulse(now, blinkUrgency);
    const color = rgba([204, 51, 51], alpha);
    const headTop = 1 - usedRatio;

    setStyle(refs.moveFill, 'height', `${usedRatio * 100}%`);
    setStyle(refs.moveFill, 'background', color);
    setStyle(refs.moveHead, 'top', `${headTop * 100}%`);
    setStyle(refs.moveHead, 'background', alpha > 0 ? color : 'rgba(255, 255, 255, 0.24)');
    setText(refs.moveValue, elapsedOnMove > 0 ? formatShortElapsed(elapsedOnMove) : '0s');
    setText(refs.moveDetail, `! ${Math.round(warnUsedRatio * 100)}%  !! ${Math.round(alertUsedRatio * 100)}%`);
  }

  function renderSliderHandles() {
    for (const slider of refs.sliders) {
      let top = 0;
      if (slider.dataset.track === 'total') {
        top = slider.dataset.handle === 'warn' ? settings.totalWarn : settings.totalAlert;
        const baseline = clock.originalMySecs;
        slider.title = slider.dataset.handle === 'warn'
          ? `Warn when total time reaches ${describeTotalThreshold(settings.totalWarn, baseline)}`
          : `Blink when total time reaches ${describeTotalThreshold(settings.totalAlert, baseline)}`;
      } else {
        top = slider.dataset.handle === 'warn' ? settings.moveWarn : settings.moveAlert;
        const usedPct = Math.round((1 - top) * 100);
        slider.title = slider.dataset.handle === 'warn'
          ? `Warn when move time reaches ${usedPct}% of the original clock`
          : `Blink when move time reaches ${usedPct}% of the original clock`;
      }
      setStyle(slider, 'top', `${top * 100}%`);
    }
    sliderRenderDirty = false;
  }

  function activate() {
    if (destroyed || active) return;
    active = true;
    render(performance.now());
    syncRenderTimer();
  }

  function deactivate() {
    active = false;
    syncRenderTimer();
  }

  function syncRenderTimer() {
    const shouldTick = active && (dragging || clock.mySecs !== null || clock.theirSecs !== null);
    if (shouldTick && !renderTimer) {
      renderTimer = window.setInterval(() => {
        render(performance.now());
      }, RENDER_INTERVAL_MS);
      return;
    }
    if (!shouldTick && renderTimer) {
      clearInterval(renderTimer);
      renderTimer = 0;
    }
  }

  function destroy() {
    destroyed = true;
    deactivate();
    window.removeEventListener('pointermove', pointerMoveListener);
    window.removeEventListener('pointerup', pointerUpListener);
    window.removeEventListener('pointercancel', pointerUpListener);
  }

  render(performance.now());

  return {
    activate,
    deactivate,
    reset,
    updateClocks,
    setMetadata,
    destroy,
  };
}

function createEmptyClockState() {
  return {
    whiteText: '--:--',
    blackText: '--:--',
    mySecs: null,
    theirSecs: null,
    originalMySecs: null,
    originalTheirSecs: null,
    activeClock: null,
    turnStartMySecs: null,
    lastSampleAt: performance.now(),
  };
}

function estimateClock(now, clock) {
  const elapsed = Math.max(0, (now - clock.lastSampleAt) / 1000);
  let mySecs = clock.mySecs;
  let theirSecs = clock.theirSecs;

  if (clock.activeClock === 'me' && mySecs !== null) {
    mySecs = Math.max(0, mySecs - elapsed);
  } else if (clock.activeClock === 'them' && theirSecs !== null) {
    theirSecs = Math.max(0, theirSecs - elapsed);
  }

  return { mySecs, theirSecs };
}

function inferActiveClock(previousMySecs, previousTheirSecs, nextMySecs, nextTheirSecs, fallback) {
  if (previousMySecs === null || previousTheirSecs === null) return fallback;

  const myDelta = nextMySecs - previousMySecs;
  const theirDelta = nextTheirSecs - previousTheirSecs;
  const epsilon = 0.15;

  if (myDelta < -epsilon && theirDelta > -epsilon) return 'me';
  if (theirDelta < -epsilon && myDelta > -epsilon) return 'them';
  if (myDelta < -epsilon && theirDelta < -epsilon) {
    return Math.abs(myDelta) >= Math.abs(theirDelta) ? 'me' : 'them';
  }

  return fallback;
}

function renderChecklistMarkup() {
  return CHECKLIST_SECTIONS.map((section) => `
    <section class="live-check-section">
      <h3>${escapeHtml(section.title)}</h3>
      ${section.items.map((item) => `
        <div class="live-check-item">
          <label class="live-check-label">
            <input type="checkbox">
            <span>${escapeHtml(item.label)}</span>
          </label>
          <button type="button" class="live-check-tip" aria-label="Explain ${escapeHtml(item.label)}">
            ?
            <span class="live-check-tip-bubble">${escapeHtml(item.tip)}</span>
          </button>
        </div>
      `).join('')}
    </section>
  `).join('');
}

function sanitizeSettings(input) {
  const totalWarn = clamp(Number(input?.totalWarn) || DEFAULT_SETTINGS.totalWarn, 0.04, 0.92);
  const totalAlert = clamp(Number(input?.totalAlert) || DEFAULT_SETTINGS.totalAlert, totalWarn + MIN_SLIDER_GAP, 0.98);
  const moveWarn = clamp(Number(input?.moveWarn) || DEFAULT_SETTINGS.moveWarn, 0.1, 0.98);
  const moveAlert = clamp(Number(input?.moveAlert) || DEFAULT_SETTINGS.moveAlert, 0.02, moveWarn - MIN_SLIDER_GAP);
  return { totalWarn, totalAlert, moveWarn, moveAlert };
}

function describeTotalThreshold(progress, baseline) {
  if (!baseline) return `${Math.round((1 - progress) * 100)}% left`;
  return formatTimeOrFallback(Math.max(0, baseline * (1 - progress)), '--:--');
}

function blinkPulse(now, urgency) {
  if (urgency <= 0) return 1;
  const durationMs = Math.max(260, 2000 - urgency * 1700);
  const phase = (now % durationMs) / durationMs;
  return 0.28 + 0.72 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr || timeStr === '?' || timeStr === '--:--') return null;

  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(parts[0]);
}

function formatTimeOrFallback(secs, fallback) {
  if (secs === null || Number.isNaN(secs)) return fallback;
  const totalSeconds = Math.max(0, secs);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatShortElapsed(secs) {
  if (secs < 10) return `${secs.toFixed(1)}s`;
  if (secs < 60) return `${Math.round(secs)}s`;
  return formatTimeOrFallback(secs, '--:--');
}

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba(rgb, alpha) {
  const safeAlpha = clamp(alpha, 0, 1);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${safeAlpha})`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
