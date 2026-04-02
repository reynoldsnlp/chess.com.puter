// Vertical evaluation bar component.
// White fill grows from bottom (or top when flipped for black's perspective).

export function createEvalBar(container) {
  container.innerHTML = `
    <div class="eval-bar-track">
      <div class="eval-bar-fill"></div>
      <div class="eval-bar-label">0.0</div>
    </div>
  `;

  const track = container.querySelector('.eval-bar-track');
  const fill = container.querySelector('.eval-bar-fill');
  const label = container.querySelector('.eval-bar-label');
  let flipped = false;
  let lastScore = null;

  function render() {
    const score = lastScore;
    if (!score) return;

    let pct, text;

    if (score.type === 'mate') {
      pct = score.value > 0 ? 96 : 4;
      text = `M${Math.abs(score.value)}`;
    } else {
      const pawns = score.value / 100;
      pct = 50 + pawns * 7;
      pct = Math.max(4, Math.min(96, pct));
      text = (score.value >= 0 ? '+' : '') + (score.value / 100).toFixed(1);
    }

    // pct = percentage of bar that is "white" (from white's perspective).
    // Default: white fill at bottom, grows upward. pct=70 → 70% white.
    // Flipped: bar is rotated so black is at bottom. Use CSS transform.
    fill.style.height = pct + '%';
    label.textContent = text;

    if (pct > 50) {
      label.style.bottom = 'auto';
      label.style.top = (100 - pct + 2) + '%';
      label.style.color = 'var(--eval-black)';
    } else {
      label.style.top = 'auto';
      label.style.bottom = (pct + 2) + '%';
      label.style.color = 'var(--eval-white)';
    }
  }

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
      label.style.top = 'auto';
      label.style.bottom = '52%';
      label.style.color = 'var(--eval-white)';
    },

    setFlipped(f) {
      flipped = f;
      // Default bar: black background, white fill from bottom = white at bottom.
      // Rotate 180° to put white at top (black at bottom).
      // The "flipped" flag should match: true = black at bottom of board.
      track.style.transform = flipped ? '' : 'rotate(180deg)';
      label.style.transform = flipped ? '' : 'rotate(180deg)';
    },
  };
}
