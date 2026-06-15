const COLORS = {
  ink: "#172321",
  muted: "#77837f",
  line: "#dbe2df",
  accent: "#2f7d68",
  accentSoft: "rgba(47, 125, 104, .16)",
};

export function drawHistogram(canvas, values, label) {
  const { ctx, width, height } = prepare(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bins = 12;
  const step = (max - min || 1) / bins;
  const counts = Array(bins).fill(0);
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.floor((value - min) / step));
    counts[index] += 1;
  });
  const pad = { left: 40, right: 12, top: 16, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxCount = Math.max(...counts);
  drawAxes(ctx, width, height, pad, min.toFixed(0), max.toFixed(0), label);
  counts.forEach((count, index) => {
    const gap = 3;
    const barW = plotW / bins - gap;
    const barH = (count / maxCount) * plotH;
    ctx.fillStyle = index === counts.indexOf(maxCount) ? COLORS.accent : COLORS.accentSoft;
    ctx.fillRect(pad.left + index * (plotW / bins) + gap / 2, pad.top + plotH - barH, barW, barH);
  });
}

export function drawScatter(canvas, candidates, selectedIndex) {
  const { ctx, width, height } = prepare(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!candidates.length) return;
  const xs = candidates.map((item) => item.heavyAtoms);
  const ys = candidates.map((item) => item.molecularWeight);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 10;
  const maxY = Math.max(...ys) + 10;
  const pad = { left: 44, right: 14, top: 16, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  drawAxes(ctx, width, height, pad, minX.toFixed(0), maxX.toFixed(0), "Heavy atoms");
  candidates.forEach((item) => {
    const x = pad.left + ((item.heavyAtoms - minX) / (maxX - minX || 1)) * plotW;
    const y = pad.top + plotH - ((item.molecularWeight - minY) / (maxY - minY || 1)) * plotH;
    const selected = item.index === selectedIndex;
    ctx.beginPath();
    ctx.arc(x, y, selected ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#c96c46" : "rgba(47, 125, 104, .55)";
    ctx.fill();
  });
}

function prepare(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = Number(canvas.getAttribute("height")) || 220;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  return { ctx, width, height };
}

function drawAxes(ctx, width, height, pad, min, max, label) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "11px DM Mono, monospace";
  ctx.fillText(min, pad.left, height - 12);
  ctx.textAlign = "right";
  ctx.fillText(max, width - pad.right, height - 12);
  ctx.textAlign = "center";
  ctx.fillText(label, pad.left + (width - pad.left - pad.right) / 2, height - 12);
  ctx.textAlign = "left";
}
