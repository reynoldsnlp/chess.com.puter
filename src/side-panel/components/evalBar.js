// Vertical evaluation bar component.
// White fill grows from bottom, proportional to the evaluation.

/**
 * @param {HTMLElement} container
 */
export function createEvalBar(container) {
  container.innerHTML = `
    <div class="eval-bar-track">
      <div class="eval-bar-fill"></div>
      <div class="eval-bar-label">0.0</div>
    </div>
  `;

  const fill = container.querySelector('.eval-bar-fill');
  const label = container.querySelector('.eval-bar-label');

  return {
    /**
     * Update the eval bar.
     * @param {{ type: 'cp'|'mate', value: number }} score
     */
    update(score) {
      if (!score) return;

      let pct, text;

      if (score.type === 'mate') {
        // Mate score: snap near the edge
        pct = score.value > 0 ? 96 : 4;
        text = `M${Math.abs(score.value)}`;
      } else {
        // Centipawn score: convert to percentage
        // Scale: 100cp = ~7% swing from center, capped at 4-96%
        const pawns = score.value / 100;
        pct = 50 + pawns * 7;
        pct = Math.max(4, Math.min(96, pct));
        text = (score.value >= 0 ? '+' : '') + (score.value / 100).toFixed(1);
      }

      fill.style.height = pct + '%';
      label.textContent = text;

      // Position label based on eval direction
      if (pct > 50) {
        label.style.bottom = 'auto';
        label.style.top = (100 - pct + 2) + '%';
        label.style.color = 'var(--eval-black)';
      } else {
        label.style.top = 'auto';
        label.style.bottom = (pct + 2) + '%';
        label.style.color = 'var(--eval-white)';
      }
    },

    reset() {
      fill.style.height = '50%';
      label.textContent = '0.0';
      label.style.top = 'auto';
      label.style.bottom = '52%';
      label.style.color = 'var(--eval-white)';
    },
  };
}
