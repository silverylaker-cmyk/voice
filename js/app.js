// app.js — UI 제어 및 분석 파이프라인 연결
import { Recorder } from './recorder.js';
import {
  resample, analyzeSustained, analyzeSpeech, ANALYSIS_SR,
} from './dsp.js';
import {
  explainSustained, explainSpeech, LEVEL, formatDuration,
} from './explain.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let recorder = null;
let currentMode = 'vowel'; // 'vowel' | 'speech'
let autoStopTimer = null;

const MIN_VOWEL_SEC = 3;
const MIN_SPEECH_SEC = 30;
const MAX_SPEECH_SEC = 300; // 5분 자동 종료

// ---- 탭 전환 ----
function switchTab(mode) {
  currentMode = mode;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.mode === mode));
  resetUI();
}

function resetUI() {
  $('#results').innerHTML = '';
  $('#results').classList.remove('show');
  setStatus('대기 중');
  $('#level-bar').style.width = '0%';
  $('#timer').textContent = '00:00';
}

function setStatus(text) {
  $('#status').textContent = text;
}

function fmtTimer(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// ---- 녹음 시작/정지 ----
async function startRecording() {
  resetUI();
  recorder = new Recorder();
  recorder.onLevel = (peak) => {
    $('#level-bar').style.width = Math.min(100, peak * 140) + '%';
  };
  recorder.onTime = (sec) => {
    $('#timer').textContent = fmtTimer(sec);
    if (currentMode === 'speech') {
      const remain = Math.max(0, MAX_SPEECH_SEC - sec);
      setStatus(`녹음 중… (최대 5분, 남은 시간 ${fmtTimer(remain)})`);
    }
  };

  try {
    await recorder.start();
  } catch (err) {
    setStatus('마이크 접근 실패 — 브라우저 권한을 허용해 주세요.');
    console.error(err);
    return;
  }

  $('#record-btn').classList.add('recording');
  $('#record-btn .btn-label').textContent = '정지';
  setStatus(
    currentMode === 'vowel'
      ? '"아~" 소리를 편안하게 3~5초간 길게 내주세요.'
      : '평소처럼 1~3분간 자연스럽게 말씀해 주세요.'
  );

  // 발화 모드: 최대 길이 자동 종료
  if (currentMode === 'speech') {
    autoStopTimer = setTimeout(() => stopRecording(), MAX_SPEECH_SEC * 1000);
  }
}

async function stopRecording() {
  if (!recorder || !recorder.recording) return;
  if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }

  const result = recorder.stop();
  $('#record-btn').classList.remove('recording');
  $('#record-btn .btn-label').textContent = currentMode === 'vowel' ? '녹음 시작' : '녹음 시작';
  $('#level-bar').style.width = '0%';

  if (!result || result.samples.length === 0) {
    setStatus('녹음된 소리가 없습니다. 다시 시도해 주세요.');
    return;
  }

  const durationSec = result.samples.length / result.sampleRate;
  const minNeeded = currentMode === 'vowel' ? MIN_VOWEL_SEC : MIN_SPEECH_SEC;
  if (durationSec < minNeeded) {
    setStatus(
      `녹음이 너무 짧습니다 (${durationSec.toFixed(1)}초). ` +
      `최소 ${minNeeded}초 이상 녹음해 주세요.`
    );
    return;
  }

  setStatus('분석 중…');
  // UI가 멈추지 않도록 다음 프레임에서 무거운 분석 수행
  await new Promise((r) => setTimeout(r, 30));

  try {
    const mono = result.samples;
    const ds = resample(mono, result.sampleRate, ANALYSIS_SR);

    if (currentMode === 'vowel') {
      const r = analyzeSustained(ds, ANALYSIS_SR);
      if (!r.ok) {
        setStatus(failReason(r.reason));
        return;
      }
      renderSustained(r);
    } else {
      const r = analyzeSpeech(ds, ANALYSIS_SR);
      if (!r.ok) {
        setStatus(failReason(r.reason));
        return;
      }
      renderSpeech(r);
    }
    setStatus('분석 완료 ✓');
  } catch (err) {
    console.error(err);
    setStatus('분석 중 오류가 발생했습니다. 다시 시도해 주세요.');
  }
}

function failReason(reason) {
  switch (reason) {
    case 'voiced_too_short':
    case 'cycles_too_few':
      return '안정적인 발성 구간이 부족합니다. 일정한 "아~" 소리를 더 길게 내주세요.';
    case 'speech_too_short':
      return '분석할 발화가 부족합니다. 더 길게, 또렷하게 말씀해 주세요.';
    default:
      return '분석에 충분한 음성이 없습니다. 다시 시도해 주세요.';
  }
}

// ---- 결과 렌더링 ----
function levelClass(level) {
  return level === LEVEL.WARN ? 'lv-warn' : level === LEVEL.MILD ? 'lv-mild' : 'lv-good';
}
function levelText(level) {
  return level === LEVEL.WARN ? '주의' : level === LEVEL.MILD ? '경계' : '양호';
}

function renderCards(parsed) {
  const box = $('#results');
  box.innerHTML = '';

  // 종합 요약 배너
  const banner = document.createElement('div');
  banner.className = 'summary ' + levelClass(parsed.level);
  banner.innerHTML = `<div class="summary-badge">${levelText(parsed.level)}</div>
    <div class="summary-text">${parsed.summary}</div>`;
  box.appendChild(banner);

  for (const item of parsed.items) {
    const card = document.createElement('div');
    card.className = 'card ' + levelClass(item.level);
    card.innerHTML = `
      <div class="card-head">
        <span class="card-key">${item.key}</span>
        <span class="card-value">${item.value}</span>
      </div>
      ${item.sub ? `<div class="card-sub">${item.sub}</div>` : ''}
      <div class="card-desc">${item.desc}</div>
    `;
    box.appendChild(card);
  }
  box.classList.add('show');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSustained(r) {
  renderCards(explainSustained(r));
}

function renderSpeech(r) {
  renderCards(explainSpeech(r));
  // SFF 히스토그램 + 컨투어 차트 삽입
  const chartBox = document.createElement('div');
  chartBox.className = 'card chart-card';
  chartBox.innerHTML = `<div class="card-key">SFF 분포 (음높이별 사용 빈도)</div>`;
  const hist = document.createElement('canvas');
  hist.className = 'chart';
  chartBox.appendChild(hist);
  const label = document.createElement('div');
  label.className = 'card-sub';
  label.textContent = '가로축: 음높이(Hz) · 세로축: 사용 빈도';
  chartBox.appendChild(label);
  $('#results').appendChild(chartBox);
  drawHistogram(hist, r.histogram, r.medianSFF);

  const contourBox = document.createElement('div');
  contourBox.className = 'card chart-card';
  contourBox.innerHTML = `<div class="card-key">음도 곡선 (시간에 따른 F0)</div>`;
  const cc = document.createElement('canvas');
  cc.className = 'chart';
  contourBox.appendChild(cc);
  const clabel = document.createElement('div');
  clabel.className = 'card-sub';
  clabel.textContent = '가로축: 시간(초) · 세로축: 음높이(Hz) · 끊긴 부분은 무성/쉼 구간';
  contourBox.appendChild(clabel);
  $('#results').appendChild(contourBox);
  drawContour(cc, r.contour);
}

// ---- 차트 (Canvas) ----
function setupCanvas(canvas, h = 180) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth - 32;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

function drawHistogram(canvas, histogram, median) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 8, r: 8, t: 10, b: 24 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const maxCount = Math.max(1, ...histogram.map((b) => b.count));
  const n = histogram.length;
  const bw = plotW / n;

  ctx.clearRect(0, 0, w, h);
  // 막대
  for (let i = 0; i < n; i++) {
    const b = histogram[i];
    const bh = (b.count / maxCount) * plotH;
    const x = pad.l + i * bw;
    const y = pad.t + (plotH - bh);
    ctx.fillStyle = '#5b8def';
    ctx.fillRect(x + 1, y, Math.max(1, bw - 2), bh);
  }
  // 중앙값 선
  const first = histogram[0].from;
  const last = histogram[histogram.length - 1].to;
  const mx = pad.l + ((median - first) / (last - first)) * plotW;
  ctx.strokeStyle = '#e0457b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx, pad.t);
  ctx.lineTo(mx, pad.t + plotH);
  ctx.stroke();
  ctx.fillStyle = '#e0457b';
  ctx.font = '11px sans-serif';
  ctx.fillText(`중앙값 ${median.toFixed(0)}Hz`, Math.min(mx + 4, w - 80), pad.t + 12);

  // x축 라벨
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.fillText(`${first}Hz`, pad.l, h - 8);
  ctx.fillText(`${last}Hz`, w - 40, h - 8);
}

function drawContour(canvas, points) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  const valid = points.filter((p) => p.f0 != null);
  if (!valid.length) return;
  const tMax = points[points.length - 1].t || 1;
  let fMin = Math.min(...valid.map((p) => p.f0));
  let fMax = Math.max(...valid.map((p) => p.f0));
  fMin = Math.floor((fMin - 10) / 10) * 10;
  fMax = Math.ceil((fMax + 10) / 10) * 10;
  if (fMax - fMin < 20) fMax = fMin + 20;

  ctx.clearRect(0, 0, w, h);
  // y축 눈금
  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '10px sans-serif';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const val = fMin + ((fMax - fMin) * g) / 3;
    const y = pad.t + plotH - (plotH * g) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(0), 2, y + 3);
  }

  const xOf = (t) => pad.l + (t / tMax) * plotW;
  const yOf = (f) => pad.t + plotH - ((f - fMin) / (fMax - fMin)) * plotH;

  ctx.strokeStyle = '#5b8def';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let drawing = false;
  for (const p of points) {
    if (p.f0 == null) { drawing = false; continue; }
    const x = xOf(p.t), y = yOf(p.f0);
    if (!drawing) { ctx.moveTo(x, y); drawing = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#999';
  ctx.fillText('0s', pad.l, h - 6);
  ctx.fillText(`${tMax.toFixed(0)}s`, w - 24, h - 6);
}

// ---- 초기화 ----
function init() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => switchTab(t.dataset.mode))
  );
  $('#record-btn').addEventListener('click', () => {
    if (recorder && recorder.recording) stopRecording();
    else startRecording();
  });

  // 마이크 지원 여부 확인
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
    $('#record-btn').disabled = true;
  }

  // 서비스워커 등록 (오프라인 지원)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('DOMContentLoaded', init);
