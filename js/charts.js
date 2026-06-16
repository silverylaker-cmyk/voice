// charts.js — Canvas 기반 공용 차트 (의존성 없음)

const COL = {
  blue: '#5b8def',
  pink: '#e0457b',
  green: '#2eb872',
  amber: '#e9a23b',
  grid: '#e8edf6',
  text: '#7a8699',
};

export function setupCanvas(canvas, h = 180) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(220, canvas.parentElement.clientWidth - 32);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawHistogram(canvas, histogram, median) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 8, r: 8, t: 10, b: 24 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const maxCount = Math.max(1, ...histogram.map((b) => b.count));
  const n = histogram.length;
  const bw = plotW / n;

  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const b = histogram[i];
    const bh = (b.count / maxCount) * plotH;
    const x = pad.l + i * bw;
    const y = pad.t + (plotH - bh);
    ctx.fillStyle = COL.blue;
    ctx.fillRect(x + 1, y, Math.max(1, bw - 2), bh);
  }
  const first = histogram[0].from;
  const last = histogram[histogram.length - 1].to;
  const mx = pad.l + ((median - first) / (last - first)) * plotW;
  ctx.strokeStyle = COL.pink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx, pad.t); ctx.lineTo(mx, pad.t + plotH); ctx.stroke();
  ctx.fillStyle = COL.pink;
  ctx.font = '11px sans-serif';
  ctx.fillText(`중앙값 ${median.toFixed(0)}Hz`, Math.min(mx + 4, w - 80), pad.t + 12);

  ctx.fillStyle = COL.text;
  ctx.font = '10px sans-serif';
  ctx.fillText(`${first}Hz`, pad.l, h - 8);
  ctx.fillText(`${last}Hz`, w - 40, h - 8);
}

// 시간-F0 컨투어. band(선택): {low, high} 녹색 타겟 영역 표시
export function drawContour(canvas, points, band = null) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  const valid = points.filter((p) => p.f0 != null);
  if (!valid.length) { ctx.clearRect(0, 0, w, h); return; }
  const tMax = points[points.length - 1].t || 1;
  let fMin = Math.min(...valid.map((p) => p.f0));
  let fMax = Math.max(...valid.map((p) => p.f0));
  if (band) { fMin = Math.min(fMin, band.low); fMax = Math.max(fMax, band.high); }
  fMin = Math.floor((fMin - 10) / 10) * 10;
  fMax = Math.ceil((fMax + 10) / 10) * 10;
  if (fMax - fMin < 20) fMax = fMin + 20;

  ctx.clearRect(0, 0, w, h);
  const yOf = (f) => pad.t + plotH - ((f - fMin) / (fMax - fMin)) * plotH;
  const xOf = (t) => pad.l + (t / tMax) * plotW;

  if (band) {
    const yHi = yOf(band.high), yLo = yOf(band.low);
    ctx.fillStyle = 'rgba(46,184,114,0.18)';
    ctx.fillRect(pad.l, yHi, plotW, yLo - yHi);
    ctx.strokeStyle = 'rgba(46,184,114,0.55)';
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, yHi); ctx.lineTo(w - pad.r, yHi); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.l, yLo); ctx.lineTo(w - pad.r, yLo); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = COL.grid;
  ctx.fillStyle = COL.text;
  ctx.font = '10px sans-serif';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const val = fMin + ((fMax - fMin) * g) / 3;
    const y = pad.t + plotH - (plotH * g) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(val.toFixed(0), 2, y + 3);
  }

  ctx.strokeStyle = COL.blue;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let drawing = false;
  for (const p of points) {
    if (p.f0 == null) { drawing = false; continue; }
    const x = xOf(p.t), y = yOf(p.f0);
    if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = COL.text;
  ctx.fillText('0s', pad.l, h - 6);
  ctx.fillText(`${tMax.toFixed(0)}s`, w - 24, h - 6);
}

// 그룹 막대: 마사지 전/후 비교. series=[{label, before, after, unit}]
export function drawBeforeAfter(canvas, series) {
  const h = 60 + series.length * 52;
  const { ctx, w } = setupCanvas(canvas, h);
  ctx.clearRect(0, 0, w, h);
  const labelW = 96;
  const barX = labelW + 6;
  const barMaxW = w - barX - 60;
  let y = 16;
  ctx.font = '12px sans-serif';
  for (const s of series) {
    const maxV = Math.max(s.before, s.after, 1e-6);
    ctx.fillStyle = '#1f2733';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(s.label, 0, y + 8);
    // before
    ctx.fillStyle = '#9fb0c9';
    const wB = (s.before / maxV) * barMaxW;
    ctx.fillRect(barX, y, wB, 14);
    ctx.fillStyle = COL.text; ctx.font = '11px sans-serif';
    ctx.fillText(fmt(s.before, s.unit), barX + wB + 4, y + 11);
    // after
    const yA = y + 18;
    ctx.fillStyle = s.betterIsLow ? (s.after <= s.before ? COL.green : COL.pink)
                                  : (s.after >= s.before ? COL.green : COL.pink);
    const wA = (s.after / maxV) * barMaxW;
    ctx.fillRect(barX, yA, wA, 14);
    ctx.fillStyle = COL.text;
    ctx.fillText(fmt(s.after, s.unit), barX + wA + 4, yA + 11);
    y += 52;
  }
  // 범례
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#9fb0c9'; ctx.fillRect(barX, h - 12, 10, 8);
  ctx.fillStyle = COL.text; ctx.fillText('전', barX + 14, h - 5);
  ctx.fillStyle = COL.green; ctx.fillRect(barX + 40, h - 12, 10, 8);
  ctx.fillStyle = COL.text; ctx.fillText('후', barX + 54, h - 5);
}

function fmt(v, unit) {
  return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) + (unit || '');
}

// 다중 시계열 꺾은선. series=[{label,color,points:[{x,y}]}], xLabels[]
export function drawLineSeries(canvas, series, xLabels, yUnit = '') {
  const { ctx, w, h } = setupCanvas(canvas, 200);
  const pad = { l: 38, r: 10, t: 12, b: 28 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  ctx.clearRect(0, 0, w, h);

  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
  if (!all.length) {
    ctx.fillStyle = COL.text; ctx.font = '12px sans-serif';
    ctx.fillText('데이터가 없습니다', pad.l, h / 2);
    return;
  }
  let yMin = Math.min(...all), yMax = Math.max(...all);
  const range = yMax - yMin || 1;
  yMin -= range * 0.1; yMax += range * 0.1;

  const n = xLabels.length;
  const xOf = (i) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.text; ctx.font = '10px sans-serif';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const val = yMin + ((yMax - yMin) * g) / 3;
    const y = pad.t + plotH - (plotH * g) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(val.toFixed(val < 10 ? 1 : 0), 2, y + 3);
  }
  // x 라벨
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = COL.text;
    ctx.fillText(xLabels[i], xOf(i) - 10, h - 8);
  }

  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    s.points.forEach((p, i) => {
      if (p.y == null) { started = false; return; }
      const x = xOf(p.x ?? i), y = yOf(p.y);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    s.points.forEach((p, i) => {
      if (p.y == null) return;
      const x = xOf(p.x ?? i), y = yOf(p.y);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
    });
  }
}

export { COL };
