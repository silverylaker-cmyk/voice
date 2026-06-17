// biofeedback.js — 세션4: 실시간 시각적 바이오피드백 (Visual Biofeedback)
// 일상 대화를 녹음하며 현재 F0를 실시간 라인으로 표시하고,
// 세션3(마사지 후)에서 저장한 타겟 F0 음역대(녹색 박스)에 맞추도록 유도. 게임화 포함.

import { Recorder } from './recorder.js';
import { resample, yinPitch, ANALYSIS_SR } from './dsp.js';

const WINDOW_SEC = 12; // 화면에 보이는 시간 폭

let rec = null;
let rafId = null;
let history = [];      // {t, f0|null}
let startTime = 0;
let target = null;
let stats = null;
let canvas = null, cvWrap = null;
let running = false;

export function renderBiofeedback(panel, api) {
  stopBiofeedback();
  panel.innerHTML = '';
  target = api.getTarget();

  const intro = document.createElement('div');
  intro.className = 'guide';
  intro.innerHTML = `<h2>실시간 바이오피드백</h2>
    <p>말하는 동안 <b>현재 목소리 높이(F0)</b>가 흐르는 선으로 표시됩니다.
    <b>녹색 영역(목표 음역대)</b> 안으로 선이 들어오도록 편안하게 말해보세요.</p>`;
  panel.appendChild(intro);

  if (!target) {
    // 타겟이 없으면 최근 검사값으로 대체 제안
    const latest = api.getLatestVowel();
    const card = document.createElement('div');
    card.className = 'card lv-mild';
    if (latest) {
      const semis = 2;
      target = {
        meanF0: latest.f0,
        lowF0: latest.f0 * Math.pow(2, -semis / 12),
        highF0: latest.f0 * Math.pow(2, semis / 12),
        fallback: true,
      };
      card.innerHTML = `<div class="card-key">목표 음역대 안내</div>
        <div class="card-desc">아직 <b>세션3(마사지 후)</b> 타겟이 없어,
        최근 음성 검사값 <b>${latest.f0.toFixed(0)}Hz</b>를 임시 목표로 사용합니다.
        세션3을 완료하면 마사지 후 음높이가 정식 목표로 설정됩니다.</div>`;
    } else {
      card.innerHTML = `<div class="card-key">목표 음역대가 없습니다</div>
        <div class="card-desc">먼저 <b>세션1</b> 또는 <b>세션3(후두 마사지)</b>을 진행해
        목표 F0를 설정해 주세요. 우선 기본값(180Hz)으로 연습할 수 있습니다.</div>`;
      target = { meanF0: 180, lowF0: 160, highF0: 202, fallback: true };
    }
    panel.appendChild(card);
  }

  // 타겟 표시
  const tinfo = document.createElement('div');
  tinfo.className = 'card target-info';
  tinfo.innerHTML = `<div class="card-key">🎯 목표 음역대</div>
    <div class="target-val">${target.lowF0.toFixed(0)} ~ ${target.highF0.toFixed(0)} <small>Hz</small>
    <span class="target-center">(중심 ${target.meanF0.toFixed(0)}Hz)</span></div>`;
  panel.appendChild(tinfo);

  // 게임화 점수판
  const score = document.createElement('div');
  score.className = 'score-board';
  score.innerHTML = `
    <div class="score-item"><div class="score-num" id="bf-score">0</div><div class="score-lab">점수</div></div>
    <div class="score-item"><div class="score-num" id="bf-intarget">0%</div><div class="score-lab">목표 적중률</div></div>
    <div class="score-item"><div class="score-num" id="bf-streak">0.0s</div><div class="score-lab">연속 유지</div></div>
    <div class="score-item"><div class="score-num" id="bf-best">0.0s</div><div class="score-lab">최고 기록</div></div>`;
  panel.appendChild(score);

  // 라이브 캔버스
  cvWrap = document.createElement('div');
  cvWrap.className = 'card chart-card live-wrap';
  cvWrap.innerHTML = `<canvas id="bf-canvas" class="live-canvas"></canvas>
    <div class="live-readout"><span id="bf-cur">–</span><small>Hz</small></div>`;
  panel.appendChild(cvWrap);
  canvas = cvWrap.querySelector('#bf-canvas');

  // 콤보/격려 메시지
  const msg = document.createElement('div');
  msg.className = 'bf-msg';
  msg.id = 'bf-msg';
  panel.appendChild(msg);

  // 컨트롤
  const ctrl = document.createElement('div');
  ctrl.className = 'recorder';
  ctrl.innerHTML = `
    <button id="bf-btn" class="record-btn"><span class="mic-dot"></span>
      <span class="btn-label">시작</span></button>
    <div id="bf-status" class="status">시작을 누르고 편하게 말해보세요.</div>`;
  panel.appendChild(ctrl);

  ctrl.querySelector('#bf-btn').addEventListener('click', () => {
    if (running) stopBiofeedback();
    else startBiofeedback();
  });

  drawLive(); // 초기 빈 화면
}

function resetStats() {
  stats = {
    score: 0, voicedFrames: 0, inTargetFrames: 0,
    streakStart: null, bestStreak: 0, combo: 0, lastVoiced: false,
  };
}

async function startBiofeedback() {
  resetStats();
  history = [];
  rec = new Recorder();
  rec.keepChunks = false; // 실시간 전용, 메모리에 누적 안 함
  rec.onBuffer = onBuffer;
  try {
    await rec.start();
  } catch (e) {
    document.getElementById('bf-status').textContent =
      '마이크 접근 실패 — 브라우저 권한을 허용해 주세요.';
    return;
  }
  running = true;
  startTime = performance.now();
  const btn = document.getElementById('bf-btn');
  btn.classList.add('recording');
  btn.querySelector('.btn-label').textContent = '정지';
  document.getElementById('bf-status').textContent = '🎙️ 듣는 중… 녹색 영역에 맞춰 말해보세요.';
  loop();
}

export function stopBiofeedback() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (rec && rec.recording) rec.stop();
  rec = null;
  const btn = document.getElementById('bf-btn');
  if (btn) {
    btn.classList.remove('recording');
    btn.querySelector('.btn-label').textContent = '시작';
  }
}

function onBuffer(buf, sr) {
  // 다운샘플 후 단일 프레임 F0 추정
  const ds = resample(buf, sr, ANALYSIS_SR);
  let f0 = 0;
  // 충분한 길이일 때만
  if (ds.length >= 600) {
    const r = yinPitch(ds, ANALYSIS_SR);
    f0 = r.f0;
  }
  const t = (performance.now() - startTime) / 1000;
  history.push({ t, f0: f0 > 0 ? f0 : null });

  // 오래된 데이터 정리
  const cutoff = t - WINDOW_SEC - 1;
  while (history.length && history[0].t < cutoff) history.shift();

  // 통계/게임화
  if (f0 > 0) {
    stats.voicedFrames++;
    const inTarget = f0 >= target.lowF0 && f0 <= target.highF0;
    if (inTarget) {
      stats.inTargetFrames++;
      if (stats.streakStart == null) stats.streakStart = t;
      const streak = t - stats.streakStart;
      if (streak > stats.bestStreak) stats.bestStreak = streak;
      stats.combo = Math.min(5, 1 + Math.floor(streak / 2));
      stats.score += stats.combo; // 적중 유지 시 콤보 가산
    } else {
      stats.streakStart = null;
      stats.combo = 0;
    }
    stats.lastVoiced = true;
  } else {
    stats.streakStart = null;
    stats.lastVoiced = false;
  }
}

function loop() {
  if (!running) return;
  drawLive();
  updateScoreboard();
  rafId = requestAnimationFrame(loop);
}

function updateScoreboard() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('bf-score', stats.score);
  const pct = stats.voicedFrames ? Math.round((stats.inTargetFrames / stats.voicedFrames) * 100) : 0;
  set('bf-intarget', pct + '%');
  const cur = stats.streakStart != null ? ((performance.now() - startTime) / 1000 - stats.streakStart) : 0;
  set('bf-streak', cur.toFixed(1) + 's');
  set('bf-best', stats.bestStreak.toFixed(1) + 's');

  // 현재 F0 읽기
  const last = [...history].reverse().find((p) => p.f0 != null);
  set('bf-cur', last ? last.f0.toFixed(0) : '–');

  // 격려 메시지
  const msg = document.getElementById('bf-msg');
  if (msg) {
    if (stats.combo >= 4) msg.textContent = '🔥 완벽해요! 이 음높이를 유지하세요!';
    else if (stats.combo >= 2) msg.textContent = '👍 좋아요! 목표 영역에 잘 머물고 있어요.';
    else if (last && last.f0 != null) {
      msg.textContent = last.f0 > target.highF0 ? '🔽 조금 낮게 말해보세요.'
        : last.f0 < target.lowF0 ? '🔼 조금 높게 말해보세요.' : '🎯 목표 영역 진입!';
    } else msg.textContent = '';
  }
}

function setupLiveCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(240, cvWrap.clientWidth - 32);
  const h = 220;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawLive() {
  if (!canvas) return;
  const { ctx, w, h } = setupLiveCanvas();
  const pad = { l: 36, r: 10, t: 10, b: 18 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  // y 범위: 타겟 중심 기준 ±1.5옥타브 정도, 최소 폭 보장
  const center = target.meanF0;
  let yMin = Math.min(center * 0.55, target.lowF0 - 20);
  let yMax = Math.max(center * 1.7, target.highF0 + 20);

  const now = running ? (performance.now() - startTime) / 1000 : (history.length ? history[history.length - 1].t : 0);
  const tEnd = Math.max(now, WINDOW_SEC);
  const tStart = tEnd - WINDOW_SEC;
  const xOf = (t) => pad.l + ((t - tStart) / WINDOW_SEC) * plotW;
  const yOf = (f) => pad.t + plotH - ((f - yMin) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfcfe';
  ctx.fillRect(pad.l, pad.t, plotW, plotH);

  // 타겟 녹색 박스
  const yHi = yOf(target.highF0), yLo = yOf(target.lowF0);
  ctx.fillStyle = 'rgba(46,184,114,0.20)';
  ctx.fillRect(pad.l, yHi, plotW, yLo - yHi);
  ctx.strokeStyle = 'rgba(46,184,114,0.65)';
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.l, yHi); ctx.lineTo(w - pad.r, yHi); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.l, yLo); ctx.lineTo(w - pad.r, yLo); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2eb872'; ctx.font = '10px sans-serif';
  ctx.fillText('목표', w - pad.r - 28, yHi - 3);

  // y 눈금
  ctx.fillStyle = '#aab4c4'; ctx.strokeStyle = '#eef2f8'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const val = yMin + ((yMax - yMin) * g) / 4;
    const y = pad.t + plotH - (plotH * g) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(val.toFixed(0), 2, y + 3);
  }

  // 피치 라인
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let started = false;
  for (const p of history) {
    if (p.t < tStart) continue;
    if (p.f0 == null) { started = false; continue; }
    const x = xOf(p.t), y = yOf(p.f0);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  // 색상: 마지막 점이 타겟 안이면 녹색
  const last = [...history].reverse().find((p) => p.f0 != null);
  const inT = last && last.f0 >= target.lowF0 && last.f0 <= target.highF0;
  ctx.strokeStyle = inT ? '#2eb872' : '#5b8def';
  ctx.stroke();

  // 현재 위치 표시 점
  if (last && last.t >= tStart) {
    const x = xOf(Math.min(last.t, tEnd)), y = yOf(last.f0);
    ctx.fillStyle = inT ? '#2eb872' : '#e0457b';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
  }
}
