// Vertical evaluation bar component.
// White fill grows from bottom (or top when flipped for black's perspective).

import { formatEvalScore, whitePerspectiveScoreSign } from '../evalUtils.js';

export function createEvalBar(container) {
  container.innerHTML = `
    <div class="eval-bar-track">
      <div class="eval-bar-fill" data-label-placement="inside">
        <div class="eval-bar-label">0.0</div>
      </div>
    </div>
  `;

  const track = container.querySelector('.eval-bar-track');
  const fill = container.querySelector('.eval-bar-fill');
  const label = container.querySelector('.eval-bar-label');
  let flipped = false;
  let lastScore = null;
  const LABEL_PADDING_PX = 6;

  function updateLabelPlacement() {
    const hasRoomInside = fill.getBoundingClientRect().height >= label.getBoundingClientRect().height + LABEL_PADDING_PX;
    fill.dataset.labelPlacement = hasRoomInside ? 'inside' : 'outside';
  }

  function render() {
    const score = lastScore;
    if (!score) return;

    let pct, text;

    if (score.type === 'mate') {
      const sign = whitePerspectiveScoreSign(score);
      pct = sign > 0 ? 96 : sign < 0 ? 4 : 50;
      text = formatEvalScore(score);
    } else {
      const pawns = score.value / 100;
      pct = 50 + pawns * 7;
      pct = Math.max(4, Math.min(96, pct));
      text = formatEvalScore(score);
    }

    // pct = percentage of bar that is "white" (from white's perspective).
    // Default: white fill at bottom, grows upward. pct=70 → 70% white.
    // Flipped: bar is rotated so black is at bottom. Use CSS transform.
    fill.style.height = pct + '%';
    label.textContent = text;
    updateLabelPlacement();
  }

  const resizeObserver = new ResizeObserver(() => {
    if (!fill.isConnected) return;
    updateLabelPlacement();
  });
  resizeObserver.observe(track);

  return {
    update(score) {
      if (!score) return;
      lastScore = score;
      render();
    },

    reset() {
      lastScore = null;
      fill.style.height = '50%';
      label.textContent = '0.0';
      updateLabelPlacement();
    },

    setFlipped(f) {
      flipped = f;
      // Default bar: black background, white fill from bottom = white at bottom.
      // Rotate 180° to put white at top (black at bottom).
      // The "flipped" flag should match: true = black at bottom of board.
      // flipped=true means black is at bottom of board → rotate so black side is at bottom of bar
      track.style.transform = flipped ? 'rotate(180deg)' : '';
      label.style.transform = flipped ? 'rotate(180deg)' : '';
    },

    destroy() {
      resizeObserver.disconnect();
    },
  };
}
