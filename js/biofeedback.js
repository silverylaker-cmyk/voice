// biofeedback.js — 세션4: 실시간 시각적 바이오피드백 (Visual Biofeedback)
// 일상 대화를 녹음하며 현재 F0를 실시간 라인으로 표시하고,
// 세션3(마사지 후)에서 저장한 타겟 F0 음역대(녹색 박스)에 맞추도록 유도. 게임화 포함.

import { Recorder } from './recorder.js';
import { yinPitch, F0_MIN, F0_MAX } from './dsp.js';

const WINDOW_SEC = 10;  // 화면에 보이는 시간 폭(초)
const SFF_WIN = 10;     // SFF 계산용 트레일링 윈도(초) — 최근 10초 발화의 평균 F0
const CHARGE_SEC = 4;   // 목표 영역에 누적 머무르면 별 1개를 얻는 데 걸리는 시간(초)

let rec = null;
let rafId = null;
let history = [];      // {t, f0|null, sff|null}
let startTime = 0;
let target = null;
let stats = null;
let canvas = null, cvWrap = null;
let running = false;
let rawWindow = [];     // 최근 raw F0(중앙값 필터용)
let smoothedF0 = null;  // EMA 평활값
let panelRef = null;    // 요약 카드 출력용 패널 참조
let lastFrameT = null;  // 충전 게이지용 프레임 간 시간차

export function renderBiofeedback(panel, api) {
  stopBiofeedback();
  panel.innerHTML = '';
  panelRef = panel;
  target = api.getTarget();

  const intro = document.createElement('div');
  intro.className = 'guide';
  intro.innerHTML = `<h2>실시간 바이오피드백 (SFF)</h2>
    <p>말하는 동안 <b>최근 10초 발화의 SFF</b>(발화 기본 주파수, 유성 F0 평균)가
    굵은 선으로 표시됩니다. <b>녹색 영역(목표 음역대)</b> 안으로 SFF 선이
    들어오도록 편안하게 말해보세요. (옅은 회색은 참고용 순간 음높이)</p>`;
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

  // 타겟 표시 (+ 수동 입력)
  const tinfo = document.createElement('div');
  tinfo.className = 'card target-info';
  tinfo.innerHTML = `<div class="card-key">🎯 목표 음역대</div>
    <div class="target-val"><span id="bf-range">${target.lowF0.toFixed(0)} ~ ${target.highF0.toFixed(0)}</span> <small>Hz</small></div>
    <div class="target-center-row">
      <label class="target-manual">F0 수동 입력
        <input type="number" id="bf-target-input" class="target-input"
          min="50" max="500" step="1" inputmode="numeric"
          value="${target.meanF0.toFixed(0)}" /> Hz
      </label>
      <span class="target-center">(중심 <span id="bf-center">${target.meanF0.toFixed(0)}</span>Hz)</span>
    </div>`;
  panel.appendChild(tinfo);

  // 수동 입력 → 중심 F0 기준 ±2반음 밴드 재계산
  const input = tinfo.querySelector('#bf-target-input');
  const applyManual = () => {
    const v = parseFloat(input.value);
    if (!isFinite(v) || v < 50 || v > 500) return;
    const semis = 2;
    target = {
      ...target,
      meanF0: v,
      lowF0: v * Math.pow(2, -semis / 12),
      highF0: v * Math.pow(2, semis / 12),
      manual: true,
    };
    tinfo.querySelector('#bf-range').textContent =
      `${target.lowF0.toFixed(0)} ~ ${target.highF0.toFixed(0)}`;
    tinfo.querySelector('#bf-center').textContent = v.toFixed(0);
    drawLive(); // 정지 상태에서도 즉시 반영(녹음 중이면 다음 프레임에 자동 반영)
  };
  input.addEventListener('input', applyManual);
  input.addEventListener('change', applyManual);

  // 게임화 점수판
  const score = document.createElement('div');
  score.className = 'score-board';
  score.innerHTML = `
    <div class="score-item star"><div class="score-num" id="bf-stars">0</div><div class="score-lab">⭐ 별</div></div>
    <div class="score-item"><div class="score-num" id="bf-score">0</div><div class="score-lab">점수</div></div>
    <div class="score-item"><div class="score-num" id="bf-intarget">0%</div><div class="score-lab">목표 적중률</div></div>
    <div class="score-item"><div class="score-num" id="bf-best">0.0s</div><div class="score-lab">최고 유지</div></div>`;
  panel.appendChild(score);

  // 라이브 캔버스
  cvWrap = document.createElement('div');
  cvWrap.className = 'card chart-card live-wrap';
  cvWrap.innerHTML = `<canvas id="bf-canvas" class="live-canvas"></canvas>
    <div class="live-readout"><span id="bf-cur">–</span><small>SFF·Hz</small></div>`;
  panel.appendChild(cvWrap);
  canvas = cvWrap.querySelector('#bf-canvas');

  // 충전 게이지(목표 영역 유지 → 별 획득)
  const charge = document.createElement('div');
  charge.className = 'charge-wrap';
  charge.innerHTML = `
    <div class="charge-head"><span id="bf-charge-lab">다음 별까지</span><span id="bf-streak">0.0s</span></div>
    <div class="charge-bar"><div id="bf-charge-fill" class="charge-fill"></div></div>`;
  panel.appendChild(charge);

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
    if (running) stopBiofeedback(true); // 사용자가 직접 정지 → 결과 요약 표시
    else startBiofeedback();
  });

  drawLive(); // 초기 빈 화면
}

function resetStats() {
  stats = {
    score: 0, voicedFrames: 0, inTargetFrames: 0,
    streakStart: null, bestStreak: 0, combo: 0, lastVoiced: false,
    stars: 0, charge: 0, flashUntil: 0,
  };
  rawWindow = [];
  smoothedF0 = null;
  lastFrameT = null;
}

// 작은 배열 중앙값
function median(arr) {
  if (!arr.length) return 0;
  const b = [...arr].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

// 옥타브 오류 보정: 기준값(ref)에 가깝도록 2배/½배로 접는다
function octaveFold(raw, ref) {
  if (!ref || ref <= 0) return raw;
  let f = raw;
  for (let k = 0; k < 3; k++) {
    if (f / ref > 1.5) f /= 2;
    else if (ref / f > 1.5) f *= 2;
    else break;
  }
  if (f < F0_MIN || f > F0_MAX) return raw; // 보정이 범위를 벗어나면 원값 유지
  return f;
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

export function stopBiofeedback(showSummary = false) {
  const hadSession = running && stats && stats.voicedFrames > 0;
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (rec && rec.recording) rec.stop();
  rec = null;
  const btn = document.getElementById('bf-btn');
  if (btn) {
    btn.classList.remove('recording');
    btn.querySelector('.btn-label').textContent = '다시 도전';
  }
  if (showSummary && hadSession) renderSummary();
}

// 세션 종료 요약 카드 (등급 + 별/적중률/최고유지 + 격려)
function renderSummary() {
  if (!panelRef) return;
  const pct = stats.voicedFrames ? Math.round((stats.inTargetFrames / stats.voicedFrames) * 100) : 0;
  const grade = (stats.stars >= 5 && pct >= 70) ? 'A'
    : (stats.stars >= 3 || pct >= 50) ? 'B' : 'C';
  const gradeMsg = grade === 'A' ? '완벽해요! 목표 음역대를 훌륭하게 유지했어요.'
    : grade === 'B' ? '잘했어요! 조금만 더 목표 영역에 머물러볼까요?'
    : '좋은 시작이에요. 녹색 영역에 더 오래 머물도록 도전해보세요!';
  let card = document.getElementById('bf-summary');
  if (card) card.remove();
  card = document.createElement('div');
  card.id = 'bf-summary';
  card.className = 'card bf-summary grade-' + grade;
  card.innerHTML = `
    <div class="bf-grade">${grade}</div>
    <div class="bf-summary-body">
      <div class="bf-summary-title">이번 연습 결과</div>
      <div class="bf-summary-stats">
        <span>⭐ ${stats.stars}</span>
        <span>🎯 ${pct}%</span>
        <span>⏱️ 최고 ${stats.bestStreak.toFixed(1)}s</span>
        <span>🏅 ${stats.score}점</span>
      </div>
      <div class="bf-summary-msg">${gradeMsg}</div>
    </div>`;
  panelRef.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function onBuffer(buf, sr) {
  // 원본 표본화율 그대로 F0 추정(다운샘플 왜곡 없이 고음 해상도 확보)
  let raw = 0;
  if (buf.length >= 1024) {
    raw = yinPitch(buf, sr).f0;
  }
  const t = (performance.now() - startTime) / 1000;

  // 평활 + 옥타브 가드
  let display = null;
  if (raw > 0) {
    const ref = smoothedF0 || (rawWindow.length ? median(rawWindow) : 0);
    raw = octaveFold(raw, ref);
    rawWindow.push(raw);
    if (rawWindow.length > 5) rawWindow.shift();
    const med = median(rawWindow);           // 단발 이상치 제거(중앙값)
    smoothedF0 = smoothedF0 == null ? med : 0.6 * smoothedF0 + 0.4 * med; // EMA
    display = smoothedF0;
  } else {
    rawWindow.length = 0;
    smoothedF0 = null; // 무성 구간에서 초기화 → 다음 발성 시작 시 새로 추정
  }

  history.push({ t, f0: display, sff: null });

  // 오래된 데이터 정리
  const cutoff = t - WINDOW_SEC - 1;
  while (history.length && history[0].t < cutoff) history.shift();

  // 최근 SFF_WIN초 발화의 SFF(유성 F0 평균) 계산 → 현재 점에 저장
  const sff = trailingSFF(t);
  history[history.length - 1].sff = sff;

  // 프레임 간 시간차(충전 게이지용)
  const dt = lastFrameT == null ? 0 : Math.max(0, Math.min(0.5, t - lastFrameT));
  lastFrameT = t;

  // 통계/게임화 (SFF 기준)
  if (sff != null) {
    stats.voicedFrames++;
    const inTarget = sff >= target.lowF0 && sff <= target.highF0;
    if (inTarget) {
      stats.inTargetFrames++;
      if (stats.streakStart == null) stats.streakStart = t;
      const streak = t - stats.streakStart;
      if (streak > stats.bestStreak) stats.bestStreak = streak;
      stats.combo = Math.min(5, 1 + Math.floor(streak / 2));
      stats.score += stats.combo;
      // 충전: 목표 영역에 머무는 동안 게이지가 찬다(콤보가 높을수록 빠르게)
      stats.charge += (dt / CHARGE_SEC) * (1 + (stats.combo - 1) * 0.15);
      if (stats.charge >= 1) {            // 게이지 가득 → 별 획득
        stats.charge = 0;
        stats.stars++;
        stats.score += 50;                // 별 보너스
        stats.flashUntil = performance.now() + 700;
        if (navigator.vibrate) navigator.vibrate(90); // 햅틱 보상
      }
    } else {
      stats.streakStart = null;
      stats.combo = 0;
      // 벗어나면 게이지가 서서히 감소(완전 초기화는 아님 → 복귀 유도)
      stats.charge = Math.max(0, stats.charge - (dt / (CHARGE_SEC * 2)));
    }
    stats.lastVoiced = true;
  } else {
    stats.streakStart = null;
    stats.lastVoiced = false;
  }
}

// 최근 SFF_WIN초 구간의 유성 F0 평균(SFF). 유성 표본이 없으면 null.
function trailingSFF(now) {
  let sum = 0, c = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].t < now - SFF_WIN) break;
    if (history[i].f0 != null) { sum += history[i].f0; c++; }
  }
  return c ? sum / c : null;
}

function loop() {
  if (!running) return;
  drawLive();
  updateScoreboard();
  rafId = requestAnimationFrame(loop);
}

function updateScoreboard() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('bf-stars', stats.stars);
  set('bf-score', stats.score);
  const pct = stats.voicedFrames ? Math.round((stats.inTargetFrames / stats.voicedFrames) * 100) : 0;
  set('bf-intarget', pct + '%');
  const cur = stats.streakStart != null ? ((performance.now() - startTime) / 1000 - stats.streakStart) : 0;
  set('bf-streak', cur.toFixed(1) + 's');
  set('bf-best', stats.bestStreak.toFixed(1) + 's');

  // 충전 게이지
  const fill = document.getElementById('bf-charge-fill');
  if (fill) {
    fill.style.width = Math.round(stats.charge * 100) + '%';
    fill.classList.toggle('full-near', stats.charge > 0.75);
  }

  // 현재 SFF 읽기
  const last = [...history].reverse().find((p) => p.sff != null);
  const sff = last ? last.sff : null;
  set('bf-cur', sff != null ? sff.toFixed(0) : '–');

  // 격려/유도 메시지 (벗어났을 땐 목표까지 거리·방향 표시)
  const msg = document.getElementById('bf-msg');
  if (msg) {
    if (sff == null) {
      msg.textContent = '';
    } else if (sff > target.highF0) {
      msg.textContent = `🔽 조금 낮게! 목표까지 ${(sff - target.highF0).toFixed(0)}Hz`;
    } else if (sff < target.lowF0) {
      msg.textContent = `🔼 조금 높게! 목표까지 ${(target.lowF0 - sff).toFixed(0)}Hz`;
    } else if (stats.combo >= 4) {
      msg.textContent = '🔥 완벽해요! 별이 차오르고 있어요!';
    } else {
      msg.textContent = '🎯 목표 영역! 이대로 유지하세요.';
    }
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

  // 현재 상태(목표 진입 여부·별 획득 플래시)
  const lastPt = [...history].reverse().find((p) => p.sff != null);
  const inZone = !!(lastPt && lastPt.sff >= target.lowF0 && lastPt.sff <= target.highF0);
  const nowMs = (typeof performance !== 'undefined') ? performance.now() : 0;
  const flashing = stats && nowMs < stats.flashUntil;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfcfe';
  ctx.fillRect(pad.l, pad.t, plotW, plotH);

  // 타겟 녹색 박스 (목표 진입 시 더 밝게 빛남)
  const yHi = yOf(target.highF0), yLo = yOf(target.lowF0);
  ctx.fillStyle = inZone ? 'rgba(46,184,114,0.34)' : 'rgba(46,184,114,0.18)';
  ctx.fillRect(pad.l, yHi, plotW, yLo - yHi);
  ctx.strokeStyle = inZone ? 'rgba(46,184,114,0.95)' : 'rgba(46,184,114,0.6)';
  ctx.setLineDash([5, 4]); ctx.lineWidth = inZone ? 2.2 : 1.5;
  ctx.beginPath(); ctx.moveTo(pad.l, yHi); ctx.lineTo(w - pad.r, yHi); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.l, yLo); ctx.lineTo(w - pad.r, yLo); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2eb872'; ctx.font = '10px sans-serif';
  ctx.fillText('🎯 목표', w - pad.r - 40, yHi - 3);

  // y 눈금
  ctx.fillStyle = '#aab4c4'; ctx.strokeStyle = '#eef2f8'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const val = yMin + ((yMax - yMin) * g) / 4;
    const y = pad.t + plotH - (plotH * g) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(val.toFixed(0), 2, y + 3);
  }
  // Y축 제목: SFF(Hz)
  ctx.fillStyle = '#8a96a8'; ctx.font = 'bold 10px sans-serif';
  ctx.fillText('SFF(Hz)', pad.l + 2, pad.t + 10);

  // 순간 F0(참고용, 옅은 회색 라인) — 실시간 발화 활동을 보조 표시
  ctx.strokeStyle = 'rgba(150,160,175,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath();
  let s2 = false;
  for (const p of history) {
    if (p.t < tStart) continue;
    if (p.f0 == null) { s2 = false; continue; }
    const x = xOf(p.t), y = yOf(p.f0);
    if (!s2) { ctx.moveTo(x, y); s2 = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // SFF 라인(굵게) — 최근 10초 발화의 평균 F0
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  let started = false;
  for (const p of history) {
    if (p.t < tStart) continue;
    if (p.sff == null) { started = false; continue; }
    const x = xOf(p.t), y = yOf(p.sff);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  // 색상: 현재 SFF가 타겟 안이면 녹색
  ctx.strokeStyle = inZone ? '#2eb872' : '#5b8def';
  ctx.stroke();

  // 현재 SFF 위치 표시 점 (목표 안에서는 맥동 + 발광 링)
  if (lastPt && lastPt.t >= tStart) {
    const x = xOf(Math.min(lastPt.t, tEnd)), y = yOf(lastPt.sff);
    if (inZone) {
      const pulse = 5 + 2 * Math.sin(nowMs / 160);
      ctx.fillStyle = 'rgba(46,184,114,0.25)';
      ctx.beginPath(); ctx.arc(x, y, pulse + 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#2eb872';
      ctx.beginPath(); ctx.arc(x, y, pulse, 0, 2 * Math.PI); ctx.fill();
    } else {
      ctx.fillStyle = '#e0457b';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
    }
  }

  // 별 획득 플래시 — 금색 오버레이 + 별 텍스트
  if (flashing) {
    const a = (stats.flashUntil - nowMs) / 700; // 1→0
    ctx.fillStyle = `rgba(255,200,40,${0.35 * a})`;
    ctx.fillRect(pad.l, pad.t, plotW, plotH);
    ctx.fillStyle = `rgba(240,160,20,${a})`;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⭐ +별!', pad.l + plotW / 2, pad.t + plotH / 2);
    ctx.textAlign = 'left';
  }
}
