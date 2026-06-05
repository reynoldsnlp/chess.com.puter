// Interactive evaluation chart (canvas).
// Shows winning chances over the game with white/black shaded areas.
// Click to jump to a move. Hover preview with classification-colored dot.

const CLAMP_CP = 1000;

const CLASS_COLORS = {
  brilliant: '#26c2a3', great: '#5c8bb0',
  best: '#96bc4b', excellent: '#96bc4b', good: '#97af8b', book: '#a88865',
  forced: '#999', inaccuracy: '#f7c631', miss: '#fa412d', mistake: '#e69a28', blunder: '#ca3431',
};

function cpToWinPct(cp) {
  const clamped = Math.max(-CLAMP_CP, Math.min(CLAMP_CP, cp));
  return 1 / (1 + Math.exp(-0.00368208 * clamped));
}

export function createEvalChart(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'eval-chart-canvas';
  container.appendChild(canvas);

  const progressMask = document.createElement('div');
  progressMask.className = 'eval-chart-progress-mask';
  container.appendChild(progressMask);

  const ctx = canvas.getContext('2d');
  let data = [];
  let currentPly = 0;
  let hoverPly = -1;
  let onClickPly = null;
  let onHoverPly = null;
  let flipped = false;
  let myColor = 'white';
  let totalPointCount = 0;

  function setupCanvas() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function xToPly(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const pointCount = Math.max(totalPointCount, data.length);
    if (pointCount < 2) return 0;
    const ply = Math.round((x / rect.width) * (pointCount - 1));
    return Math.max(0, Math.min(pointCount - 1, ply));
  }

  function updateProgressMask(width) {
    const pointCount = Math.max(totalPointCount, data.length);
    const progress = pointCount < 2 || data.length < 2 ? 0 : (data.length - 1) / (pointCount - 1);
    const revealMargin = data.length < 2 ? 0 : 5;
    const left = Math.min(width, (progress * width) + revealMargin);
    progressMask.style.left = `${left}px`;
    progressMask.style.width = `${Math.max(0, width - left)}px`;
  }

  function render() {
    setupCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    updateProgressMask(w);
    if (data.length < 2) return;

    const pad = { left: 0, right: 0, top: 2, bottom: 2 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const midY = pad.top + plotH / 2;
    const pointCount = Math.max(totalPointCount, data.length);

    const points = data.map((d, i) => {
      const x = pad.left + (i / (pointCount - 1)) * plotW;
      let pct = d.whiteWinPct;
      if (flipped) pct = 1 - pct;
      const y = pad.top + (1 - pct) * plotH;
      return { x, y };
    });

    const smoothed = cardinalSpline(points, 0.4, 8);

    // Area above center line (white advantage when not flipped, black when flipped)
    ctx.beginPath();
    ctx.moveTo(smoothed[0].x, midY);
    for (const p of smoothed) ctx.lineTo(p.x, Math.min(p.y, midY));
    ctx.lineTo(smoothed[smoothed.length - 1].x, midY);
    ctx.closePath();
    ctx.fillStyle = flipped ? 'rgba(0, 0, 0, 1)' : 'rgba(235, 235, 235, 0.9)';
    ctx.fill();

    // Area below center line (black advantage when not flipped, white when flipped)
    ctx.beginPath();
    ctx.moveTo(smoothed[0].x, midY);
    for (const p of smoothed) ctx.lineTo(p.x, Math.max(p.y, midY));
    ctx.lineTo(smoothed[smoothed.length - 1].x, midY);
    ctx.closePath();
    ctx.fillStyle = flipped ? 'rgba(235, 235, 235, 0.9)' : 'rgba(0, 0, 0, 1)';
    ctx.fill();

    // Center line
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, midY);
    ctx.lineTo(pad.left + plotW, midY);
    ctx.stroke();

    drawContrastEvalLine(ctx, smoothed, midY, flipped);

    // Classification markers (my negative moves only)
    for (let i = 0; i < data.length; i++) {
      // Only show markers for my moves
      const isMyPly = myColor === 'white' ? i % 2 === 1 : i % 2 === 0;
      if (!isMyPly) continue;
      const cls = data[i].classification;
      if (!cls || !CLASS_COLORS[cls] || cls === 'best' || cls === 'excellent' || cls === 'good' || cls === 'book' || cls === 'forced') continue;
      ctx.fillStyle = CLASS_COLORS[cls];
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Current move indicator
    if (currentPly >= 0 && currentPly < points.length) {
      const p = points[currentPly];
      const cls = data[currentPly].classification;
      const dotColor = (cls && CLASS_COLORS[cls]) ? CLASS_COLORS[cls] : '#aaa';

      // Off-white vertical line
      ctx.strokeStyle = 'rgba(220, 220, 220, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, pad.top);
      ctx.lineTo(p.x, pad.top + plotH);
      ctx.stroke();

      // Classification-colored dot
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hover indicator (if different from current)
    if (hoverPly >= 0 && hoverPly < points.length && hoverPly !== currentPly) {
      const p = points[hoverPly];
      const cls = data[hoverPly].classification;
      const dotColor = (cls && CLASS_COLORS[cls]) ? CLASS_COLORS[cls] : '#aaa';

      // Vertical line
      ctx.strokeStyle = 'rgba(180, 180, 180, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, pad.top);
      ctx.lineTo(p.x, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot in classification color
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mouse events
  canvas.addEventListener('mousemove', (e) => {
    if (data.length < 2) return;
    const ply = xToPly(e.clientX);
    if (ply !== hoverPly) {
      hoverPly = ply;
      render();
      onHoverPly?.(ply);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (hoverPly !== -1) {
      hoverPly = -1;
      render();
      onHoverPly?.(-1);
    }
  });

  canvas.addEventListener('click', (e) => {
    if (data.length < 2 || !onClickPly) return;
    onClickPly(xToPly(e.clientX));
  });

  const resizeObserver = new ResizeObserver(() => { if (data.length > 0) render(); });
  resizeObserver.observe(container);

  return {
    setData(classifications, positions) {
      data = [];
      totalPointCount = positions?.length || classifications?.length || 0;
      const availablePointCount = Math.min(classifications?.length || 0, totalPointCount);

      for (let i = 0; i < availablePointCount; i++) {
        const cls = classifications?.[i];
        let cp = 0;
        if (i === 0 && classifications?.[1]) cp = classifications[1].evalBefore || 0;
        else if (i > 0 && cls) cp = cls.evalAfter || 0;
        else if (i > 0) break;
        data.push({
          whiteWinPct: cpToWinPct(cp),
          classification: cls?.classification || null,
        });
      }
      render();
    },

    setCurrentPly(ply) { currentPly = ply; render(); },

    setFlipped(f) { flipped = f; render(); },

    setPlayerColor(color) { myColor = color; render(); },

    onClick(fn) { onClickPly = fn; },

    onHover(fn) { onHoverPly = fn; },

    destroy() { resizeObserver.disconnect(); },
  };
}

function cardinalSpline(points, tension = 0.4, segments = 8) {
  if (points.length < 2) return points;
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let t = 0; t < segments; t++) {
      const s = t / segments, s2 = s * s, s3 = s2 * s, tx = 0.5 * tension;
      result.push({
        x: (2*s3 - 3*s2 + 1)*p1.x + (s3 - 2*s2 + s)*(p2.x - p0.x)*tx + (-2*s3 + 3*s2)*p2.x + (s3 - s2)*(p3.x - p1.x)*tx,
        y: (2*s3 - 3*s2 + 1)*p1.y + (s3 - 2*s2 + s)*(p2.y - p0.y)*tx + (-2*s3 + 3*s2)*p2.y + (s3 - s2)*(p3.y - p1.y)*tx,
      });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function drawContrastEvalLine(ctx, points, midY, flipped) {
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const fromDelta = from.y - midY;
    const toDelta = to.y - midY;

    if (fromDelta * toDelta < 0) {
      const t = (midY - from.y) / (to.y - from.y);
      const crossing = {
        x: from.x + ((to.x - from.x) * t),
        y: midY,
      };
      drawEvalSegment(ctx, from, crossing, lineColorForY(from.y, midY, flipped));
      drawEvalSegment(ctx, crossing, to, lineColorForY(to.y, midY, flipped));
    } else {
      const midpointY = (from.y + to.y) / 2;
      drawEvalSegment(ctx, from, to, lineColorForY(midpointY, midY, flipped));
    }
  }
}

function drawEvalSegment(ctx, from, to, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function lineColorForY(y, midY, flipped) {
  if (Math.abs(y - midY) < 0.5) return 'rgba(0, 0, 0, 0.9)';

  const aboveMid = y < midY;
  const whiteFill = flipped ? !aboveMid : aboveMid;
  return whiteFill ? 'rgba(235, 235, 235, 0.95)' : 'rgba(0, 0, 0, 0.9)';
}
