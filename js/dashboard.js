// dashboard.js — 세션5: 종단적 추적 대시보드 (Longitudinal Tracking)
// 달력 모드 / 주간 모드 토글. 일자별 F0·CPP 등 수치와 마사지 수행 여부 기록.

import { aggregateByDay } from './store.js';
import { drawLineSeries, COL } from './charts.js';

let viewMode = 'calendar';   // 'calendar' | 'weekly'
let calMonth = null;          // Date (해당 월 1일)

export function renderDashboard(panel) {
  panel.innerHTML = '';
  if (!calMonth) {
    const now = new Date();
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const intro = document.createElement('div');
  intro.className = 'guide';
  intro.innerHTML = `<h2>추적 대시보드</h2>
    <p>검사 기록을 <b>달력</b>과 <b>주간 그래프</b>로 추적합니다.
    일자별 F0·CPP 수치와 후두 마사지 수행 여부가 자동으로 기록됩니다.</p>`;
  panel.appendChild(intro);

  // 모드 토글
  const toggle = document.createElement('div');
  toggle.className = 'mode-toggle';
  toggle.innerHTML = `
    <button class="mode-btn ${viewMode === 'calendar' ? 'on' : ''}" data-m="calendar">📅 달력</button>
    <button class="mode-btn ${viewMode === 'weekly' ? 'on' : ''}" data-m="weekly">📈 주간</button>`;
  panel.appendChild(toggle);
  toggle.querySelectorAll('.mode-btn').forEach((b) =>
    b.addEventListener('click', () => { viewMode = b.dataset.m; renderDashboard(panel); }));

  const body = document.createElement('div');
  panel.appendChild(body);

  const data = aggregateByDay();
  const hasData = Object.keys(data).length > 0;
  if (!hasData) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.innerHTML = `<div class="card-desc">아직 기록이 없습니다.
      세션1·2에서 검사를 진행하면 이곳에 자동으로 누적됩니다.</div>`;
    body.appendChild(empty);
    return;
  }

  if (viewMode === 'calendar') renderCalendar(body, data);
  else renderWeekly(body, data);
}

function renderCalendar(body, data) {
  // 월 네비게이션
  const nav = document.createElement('div');
  nav.className = 'cal-nav';
  const label = `${calMonth.getFullYear()}년 ${calMonth.getMonth() + 1}월`;
  nav.innerHTML = `<button class="slide-btn" data-d="-1">‹</button>
    <span class="cal-title">${label}</span>
    <button class="slide-btn" data-d="1">›</button>`;
  body.appendChild(nav);
  nav.querySelectorAll('.slide-btn').forEach((b) =>
    b.addEventListener('click', () => {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(b.dataset.d), 1);
      renderDashboard(body.closest('.panel'));
    }));

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d) => {
    const head = document.createElement('div');
    head.className = 'cal-dow';
    head.textContent = d;
    grid.appendChild(head);
  });

  const year = calMonth.getFullYear(), month = calMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDow; i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    grid.appendChild(e);
  }
  const todayKey = keyOf(new Date());
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = data[key];
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (rec ? ' has' : '') + (key === todayKey ? ' today' : '');
    let inner = `<div class="cal-day">${d}${rec && rec.massage ? '<span class="cal-massage" title="마사지 수행">💆</span>' : ''}</div>`;
    if (rec) {
      if (rec.f0 != null) inner += `<div class="cal-metric f0">${rec.f0.toFixed(0)}Hz</div>`;
      if (rec.cpp != null) inner += `<div class="cal-metric cpp">CPP ${rec.cpp.toFixed(1)}</div>`;
      inner += `<div class="cal-count">${rec.count}회</div>`;
    }
    cell.innerHTML = inner;
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  // 범례
  const legend = document.createElement('div');
  legend.className = 'card cal-legend';
  legend.innerHTML = `<div class="card-sub">셀 표시: <b>F0 평균</b> · <b>CPP 평균</b> · 검사 횟수 ·
    💆 마사지 수행일. 오늘은 파란 테두리로 표시됩니다.</div>`;
  body.appendChild(legend);
}

function renderWeekly(body, data) {
  // 최근 14일 시계열
  const days = 14;
  const today = new Date();
  const labels = [], keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    keys.push(keyOf(d));
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  // 라벨 과밀 방지: 일부만 표시
  const sparseLabels = labels.map((l, i) => (i % 2 === 0 ? l : ''));

  const f0Pts = keys.map((k, i) => ({ x: i, y: data[k]?.f0 ?? null }));
  const cppPts = keys.map((k, i) => ({ x: i, y: data[k]?.cpp ?? null }));
  const jitPts = keys.map((k, i) => ({ x: i, y: data[k]?.jitter ?? null }));
  const shimPts = keys.map((k, i) => ({ x: i, y: data[k]?.shimmer ?? null }));

  body.appendChild(weekChart('F0 (기본 주파수, Hz)',
    [{ label: 'F0', color: COL.blue, points: f0Pts }], sparseLabels,
    '말하기·발성 시 평균 음높이의 일별 추이입니다.'));

  body.appendChild(weekChart('CPP (음질 지표, dB)',
    [{ label: 'CPP', color: COL.green, points: cppPts }], sparseLabels,
    '값이 높을수록 맑은 음질. 발화 평가(세션2)에서 기록됩니다.'));

  body.appendChild(weekChart('Jitter / Shimmer (%)',
    [{ label: 'Jitter', color: COL.pink, points: jitPts },
     { label: 'Shimmer', color: COL.amber, points: shimPts }], sparseLabels,
    '음성 검사(세션1)의 떨림 지표. 낮을수록 안정적입니다.'));

  // 요약 통계
  const summary = document.createElement('div');
  summary.className = 'card';
  const recentF0 = f0Pts.filter((p) => p.y != null);
  const recentCpp = cppPts.filter((p) => p.y != null);
  summary.innerHTML = `<div class="card-key">최근 14일 요약</div>
    <div class="card-desc">
    측정일 ${new Set(keys.filter((k) => data[k])).size}일 ·
    F0 평균 ${recentF0.length ? avg(recentF0).toFixed(0) + 'Hz' : '–'} ·
    CPP 평균 ${recentCpp.length ? avg(recentCpp).toFixed(1) + 'dB' : '–'}</div>`;
  body.appendChild(summary);
}

function weekChart(title, series, labels, desc) {
  const card = document.createElement('div');
  card.className = 'card chart-card';
  card.innerHTML = `<div class="card-key">${title}</div>`;
  const cv = document.createElement('canvas');
  cv.className = 'chart';
  card.appendChild(cv);
  const sub = document.createElement('div');
  sub.className = 'card-sub';
  // 범례
  sub.innerHTML = series.map((s) =>
    `<span style="color:${s.color}">●</span> ${s.label}`).join('  ') + ` — ${desc}`;
  card.appendChild(sub);
  // 캔버스는 DOM 삽입 후 그려야 폭이 잡힘 → 다음 틱
  requestAnimationFrame(() => drawLineSeries(cv, series, labels));
  return card;
}

function avg(pts) {
  return pts.reduce((s, p) => s + p.y, 0) / pts.length;
}
function keyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
