// app.js — UI 제어 및 분석 파이프라인 연결 (5개 세션 코디네이터)
import { Recorder } from './recorder.js';
import { resample, analyzeSustained, analyzeSpeech, ANALYSIS_SR } from './dsp.js';
import { explainSustained, explainSpeech, explainCombined, LEVEL } from './explain.js';
import { drawHistogram, drawContour, drawLineSeries, COL } from './charts.js';
import * as store from './store.js';
import { renderMassage } from './massage.js';
import { renderBiofeedback, stopBiofeedback } from './biofeedback.js';
import { renderDashboard } from './dashboard.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let recorder = null;
let currentMode = 'vowel';
let autoStopTimer = null;

// 현재 녹음 세션의 목적: { type:'vowel'|'speech', tag, onResult(result) }
let testContext = null;

const MIN_VOWEL_SEC = 3;
const MIN_SPEECH_SEC = 30;
const MAX_SPEECH_SEC = 300;

const RECORDER_MODES = new Set(['vowel', 'speech']);

// 세션3(마사지)에 전달할 API
const massageApi = {
  getLatestVowel: () => store.getLatest('vowel'),
  addMassageDay: () => store.addMassageDay(),
  setTarget: (t) => store.setTarget(t),
  requestVowelRetest: (onResult) => beginRetest(onResult),
  renderVowelTrend: (box) => renderVowelTrend(box),
};
const sessionApi = {
  getTarget: () => store.getTarget(),
  getLatestVowel: () => store.getLatest('vowel'),
};

// ---- 탭 전환 ----
function switchTab(mode) {
  // 진행 중 작업 정리
  if (recorder && recorder.recording) { try { recorder.stop(); } catch (e) {} }
  stopBiofeedback();
  if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
  testContext = null;

  currentMode = mode;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.mode === mode));

  // 공용 녹음 컨트롤/결과 표시 여부
  const recBlock = $('#recorder-block');
  if (RECORDER_MODES.has(mode)) {
    recBlock.hidden = false;
    setupStandardTest(mode);
  } else {
    recBlock.hidden = true;
  }

  resetUI();

  if (mode === 'massage') renderMassage($('.panel[data-mode="massage"]'), massageApi);
  else if (mode === 'biofeedback') renderBiofeedback($('.panel[data-mode="biofeedback"]'), sessionApi);
  else if (mode === 'dashboard') renderDashboard($('.panel[data-mode="dashboard"]'));
}

// 세션1·2 표준 검사 컨텍스트
function setupStandardTest(mode) {
  testContext = {
    type: mode,
    tag: null,
    onResult: (result) => {
      store.addRecord(mode, result, null);
      if (mode === 'vowel') renderSustained(result);
      else renderSpeech(result);
    },
  };
  $('#record-btn .btn-label').textContent = '녹음 시작';
  $('#record-guide').textContent = mode === 'vowel'
    ? '"아~" 소리를 3~5초간 일정하게 길게 내주세요.'
    : '평소처럼 1~3분간 자연스럽게 말씀해 주세요. (최대 5분)';
}

// 세션3에서 호출: 마사지 후 모음 재검사 시작
function beginRetest(onResult) {
  currentMode = 'vowel-retest';
  const recBlock = $('#recorder-block');
  recBlock.hidden = false;
  testContext = {
    type: 'vowel',
    tag: 'after',
    onResult: (result) => {
      store.addRecord('vowel', result, 'after');
      onResult(result);
    },
  };
  $('#record-guide').textContent =
    '마사지 후 검사입니다. 편안하게 "아~" 소리를 3~5초간 길게 내주세요.';
  setStatus('마사지 후 검사 — 준비되면 녹음을 시작하세요.');
  recBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetUI() {
  $('#results').innerHTML = '';
  $('#results').classList.remove('show');
  setStatus('대기 중');
  $('#level-bar').style.width = '0%';
  $('#timer').textContent = '00:00';
}

function setStatus(text) { $('#status').textContent = text; }

function fmtTimer(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// ---- 녹음 시작/정지 ----
async function startRecording() {
  if (!testContext) return;
  $('#results').innerHTML = '';
  $('#results').classList.remove('show');
  $('#timer').textContent = '00:00';

  recorder = new Recorder();
  recorder.onLevel = (peak) => { $('#level-bar').style.width = Math.min(100, peak * 140) + '%'; };
  const isSpeech = testContext.type === 'speech';
  recorder.onTime = (sec) => {
    $('#timer').textContent = fmtTimer(sec);
    if (isSpeech) {
      const remain = Math.max(0, MAX_SPEECH_SEC - sec);
      setStatus(`녹음 중… (최대 5분, 남은 시간 ${fmtTimer(remain)})`);
    }
  };

  try {
    await recorder.start();
  } catch (err) {
    setStatus('마이크 접근 실패 — 브라우저 권한을 허용해 주세요.');
    return;
  }

  $('#record-btn').classList.add('recording');
  $('#record-btn .btn-label').textContent = '정지';
  setStatus(isSpeech
    ? '평소처럼 자연스럽게 말씀해 주세요.'
    : '"아~" 소리를 편안하게 길게 내주세요.');

  if (isSpeech) autoStopTimer = setTimeout(() => stopRecording(), MAX_SPEECH_SEC * 1000);
}

async function stopRecording() {
  if (!recorder || !recorder.recording) return;
  if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }

  const result = recorder.stop();
  $('#record-btn').classList.remove('recording');
  $('#record-btn .btn-label').textContent = '녹음 시작';
  $('#level-bar').style.width = '0%';

  if (!result || result.samples.length === 0) {
    setStatus('녹음된 소리가 없습니다. 다시 시도해 주세요.');
    return;
  }

  const type = testContext.type;
  const durationSec = result.samples.length / result.sampleRate;
  const minNeeded = type === 'vowel' ? MIN_VOWEL_SEC : MIN_SPEECH_SEC;
  if (durationSec < minNeeded) {
    setStatus(`녹음이 너무 짧습니다 (${durationSec.toFixed(1)}초). 최소 ${minNeeded}초 이상 녹음해 주세요.`);
    return;
  }

  setStatus('분석 중…');
  await new Promise((r) => setTimeout(r, 30));

  try {
    const ds = resample(result.samples, result.sampleRate, ANALYSIS_SR);
    const r = type === 'vowel'
      ? analyzeSustained(ds, ANALYSIS_SR)
      : analyzeSpeech(ds, ANALYSIS_SR);
    if (!r.ok) { setStatus(failReason(r.reason)); return; }
    setStatus('분석 완료 ✓');
    testContext.onResult(r);
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

// ---- 결과 렌더링 (세션1·2) ----
function levelClass(level) {
  return level === LEVEL.WARN ? 'lv-warn' : level === LEVEL.MILD ? 'lv-mild' : 'lv-good';
}
function levelText(level) {
  return level === LEVEL.WARN ? '주의' : level === LEVEL.MILD ? '경계' : '양호';
}

function renderCards(parsed) {
  const box = $('#results');
  box.innerHTML = '';
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
      <div class="card-desc">${item.desc}</div>`;
    box.appendChild(card);
  }
  box.classList.add('show');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// #results 에 단일 카드(종합 해석 등)를 덧붙인다
function appendCard(item) {
  const card = document.createElement('div');
  card.className = 'card ' + levelClass(item.level);
  card.innerHTML = `
    <div class="card-head">
      <span class="card-key">${item.key}</span>
      <span class="card-value">${item.value}</span>
    </div>
    ${item.sub ? `<div class="card-sub">${item.sub}</div>` : ''}
    <div class="card-desc">${item.desc}</div>`;
  $('#results').appendChild(card);
}

// 세션1 지터 × 세션2 CPPS 종합 해석 카드(상대 기록이 있을 때만)
function appendCombined(jitter, cpps) {
  if (jitter == null || cpps == null) return;
  appendCard(explainCombined(jitter, cpps));
}

function renderSustained(r) {
  renderCards(explainSustained(r));
  // 최근 발화(세션2) CPPS가 있으면 종합 해석 추가
  const speech = store.getLatest('speech');
  if (speech) appendCombined(r.jitterLocal, speech.cpp);
}

function renderSpeech(r) {
  renderCards(explainSpeech(r));
  // 최근 음성검사(세션1) 지터가 있으면 종합 해석 추가
  const vowel = store.getLatest('vowel');
  if (vowel) appendCombined(vowel.jitter, r.meanCPPS);
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

// 세션3 비교에서 사용: 지금까지의 모음 검사 F0/Jitter 시간 추이
function renderVowelTrend(box) {
  const recs = store.getRecords().filter((r) => r.type === 'vowel');
  if (recs.length < 2) return;
  const card = document.createElement('div');
  card.className = 'card chart-card';
  card.innerHTML = `<div class="card-key">시간에 따른 변화 추이 (모음 검사)</div>`;
  const cv = document.createElement('canvas');
  cv.className = 'chart';
  card.appendChild(cv);
  const sub = document.createElement('div');
  sub.className = 'card-sub';
  sub.innerHTML = `<span style="color:${COL.blue}">●</span> F0(Hz)  ` +
    `<span style="color:${COL.pink}">●</span> Jitter(%)  — 가장 최근 점이 마사지 후 결과입니다.`;
  card.appendChild(sub);
  box.appendChild(card);

  const last = recs.slice(-8);
  const labels = last.map((r) => {
    const d = new Date(r.ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }).map((l, i, arr) => (arr.length > 5 && i % 2 ? '' : l));
  const f0Pts = last.map((r, i) => ({ x: i, y: r.f0 }));
  const jitPts = last.map((r, i) => ({ x: i, y: r.jitter ?? null }));
  requestAnimationFrame(() =>
    drawLineSeries(cv, [
      { label: 'F0', color: COL.blue, points: f0Pts },
      { label: 'Jitter', color: COL.pink, points: jitPts },
    ], labels));
}

// ---- 초기화 ----
function init() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.mode)));
  $('#record-btn').addEventListener('click', () => {
    if (recorder && recorder.recording) stopRecording();
    else startRecording();
  });

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
    $('#record-btn').disabled = true;
  }

  setupStandardTest('vowel');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('DOMContentLoaded', init);
