// Live helper mode coordinator.
// Shows non-evaluative tools during active games.
// NO engine analysis - anti-cheating by design.

import { LOW_TIME_THRESHOLD_SECONDS } from '../../shared/constants.js';

export function createLiveHelper(container) {
  let blinkThreshold = LOW_TIME_THRESHOLD_SECONDS;
  let blinkInterval = null;

  // Load saved threshold
  chrome.storage?.local?.get(['lowTimeThreshold'], (result) => {
    if (result.lowTimeThreshold) blinkThreshold = result.lowTimeThreshold;
  });

  container.innerHTML = `
    <div class="live-helper">
      <div class="live-helper-notice">
        <strong>Stockfish analysis is disabled during active games.</strong>
        <p>Free the fish, not the cheats!</p>
      </div>

      <div class="live-helper-clocks">
        <div class="clock-row">
          <div class="clock-block">
            <label>Your time</label>
            <div class="clock-bar-track"><div class="clock-bar-fill" id="player-bar"></div></div>
            <span class="clock-time" id="player-time">--:--</span>
          </div>
          <div class="clock-block">
            <label>Opponent</label>
            <div class="clock-bar-track"><div class="clock-bar-fill" id="opponent-bar"></div></div>
            <span class="clock-time" id="opponent-time">--:--</span>
          </div>
        </div>
        <div class="time-diff" id="time-diff"></div>
      </div>

      <div class="live-helper-blink-setting">
        <label>Low time alert at &lt;</label>
        <input type="number" id="blink-threshold" value="${blinkThreshold}" min="5" max="120" step="5">
        <label>seconds</label>
      </div>

      <div class="live-helper-footer">
        <p>Analysis will unlock when the game ends.</p>
      </div>
    </div>
  `;

  const playerTime = container.querySelector('#player-time');
  const opponentTime = container.querySelector('#opponent-time');
  const playerBar = container.querySelector('#player-bar');
  const opponentBar = container.querySelector('#opponent-bar');
  const timeDiff = container.querySelector('#time-diff');
  const thresholdInput = container.querySelector('#blink-threshold');

  thresholdInput.addEventListener('change', () => {
    blinkThreshold = parseInt(thresholdInput.value) || LOW_TIME_THRESHOLD_SECONDS;
    chrome.storage?.local?.set({ lowTimeThreshold: blinkThreshold });
  });

  return {
    updateClocks({ whiteTime, blackTime, playerColor }) {
      const isWhite = playerColor === 'white';
      const myTime = isWhite ? whiteTime : blackTime;
      const theirTime = isWhite ? blackTime : whiteTime;

      playerTime.textContent = myTime;
      opponentTime.textContent = theirTime;

      // Parse time strings to seconds for comparison
      const mySecs = parseTimeToSeconds(myTime);
      const theirSecs = parseTimeToSeconds(theirTime);

      if (mySecs !== null && theirSecs !== null) {
        // Update progress bars (relative to max of both)
        const maxSecs = Math.max(mySecs, theirSecs, 1);
        playerBar.style.width = (mySecs / maxSecs * 100) + '%';
        opponentBar.style.width = (theirSecs / maxSecs * 100) + '%';

        // Color code
        setBarColor(playerBar, mySecs, maxSecs);
        setBarColor(opponentBar, theirSecs, maxSecs);

        // Time difference
        const diff = mySecs - theirSecs;
        if (diff > 0) {
          timeDiff.textContent = `You have +${formatSeconds(Math.abs(diff))} more`;
        } else if (diff < 0) {
          timeDiff.textContent = `Opponent has +${formatSeconds(Math.abs(diff))} more`;
        } else {
          timeDiff.textContent = 'Times are equal';
        }

        // Low time blink
        if (mySecs <= blinkThreshold && mySecs > 0) {
          container.classList.add('low-time-blink');
        } else {
          container.classList.remove('low-time-blink');
        }
      }
    },

    setMetadata(metadata) {
      // Could display player names, etc.
    },

    destroy() {
      if (blinkInterval) clearInterval(blinkInterval);
      container.classList.remove('low-time-blink');
    },
  };
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr || timeStr === '?' || timeStr === '--:--') return null;

  // Handle formats: "5:23", "0:45", "1:23:45", "45", "5.2"
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  } else {
    return parseFloat(parts[0]);
  }
}

function formatSeconds(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function setBarColor(bar, secs, maxSecs) {
  const ratio = secs / maxSecs;
  if (ratio > 0.5) {
    bar.style.background = 'var(--accent)';
  } else if (ratio > 0.25) {
    bar.style.background = 'var(--warning)';
  } else {
    bar.style.background = 'var(--danger)';
  }
}
