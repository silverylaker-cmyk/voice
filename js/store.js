// store.js — localStorage 기반 영속 저장소
// 세션 간 데이터 공유: 검사 이력, 마사지 전/후 결과, 타겟 F0, 마사지 수행 기록

const KEY = 'voiceAnalysis.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { records: [], massageDays: [], target: null };
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}

let state = load();

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 검사 결과 1건 저장.
// type: 'vowel' | 'speech', metrics: 분석 결과 객체, tag: 'before'|'after'|null
export function addRecord(type, metrics, tag = null) {
  const now = new Date();
  const rec = {
    id: now.getTime() + '-' + Math.random().toString(36).slice(2, 7),
    ts: now.toISOString(),
    date: dateKey(now),
    type,
    tag,
  };
  if (type === 'vowel') {
    rec.f0 = metrics.meanF0;
    rec.f0sd = metrics.sdF0;
    rec.f0min = metrics.minF0;
    rec.f0max = metrics.maxF0;
    rec.jitter = metrics.jitterLocal;
    rec.shimmer = metrics.shimmerLocal;
    rec.shimmerDB = metrics.shimmerDB;
  } else {
    rec.f0 = metrics.meanSFF;
    rec.f0sd = metrics.sdSFF;
    rec.f0min = metrics.minSFF;
    rec.f0max = metrics.maxSFF;
    rec.cpp = metrics.meanCPP;
    rec.breaks = metrics.breaksPerMin;
    rec.sdST = metrics.sdST;
  }
  state.records.push(rec);
  save(state);
  return rec;
}

export function getRecords() {
  return state.records.slice();
}

// 특정 타입의 가장 최근 기록
export function getLatest(type, tag = null) {
  for (let i = state.records.length - 1; i >= 0; i--) {
    const r = state.records[i];
    if (r.type === type && (tag == null || r.tag === tag)) return r;
  }
  return null;
}

// 마사지 후 타겟 F0 설정/조회 (세션4 바이오피드백 가이드)
export function setTarget(target) {
  state.target = { ...target, ts: new Date().toISOString() };
  save(state);
}
export function getTarget() {
  return state.target;
}

// 마사지 세션 수행 기록 (해당 날짜)
export function addMassageDay() {
  const k = dateKey();
  if (!state.massageDays.includes(k)) {
    state.massageDays.push(k);
    save(state);
  }
}
export function getMassageDays() {
  return state.massageDays.slice();
}
export function hasMassageOn(dateStr) {
  return state.massageDays.includes(dateStr);
}

// 날짜별 집계 (대시보드용)
// 반환: { 'YYYY-MM-DD': { f0:[], cpp:[], jitter:[], shimmer:[], breaks:[], massage:bool, count } }
export function aggregateByDay() {
  const map = {};
  for (const r of state.records) {
    if (!map[r.date]) {
      map[r.date] = { f0: [], cpp: [], jitter: [], shimmer: [], breaks: [], count: 0 };
    }
    const d = map[r.date];
    if (r.f0 != null) d.f0.push(r.f0);
    if (r.cpp != null) d.cpp.push(r.cpp);
    if (r.jitter != null) d.jitter.push(r.jitter);
    if (r.shimmer != null) d.shimmer.push(r.shimmer);
    if (r.breaks != null) d.breaks.push(r.breaks);
    d.count++;
  }
  // 평균 계산 + 마사지 여부
  const out = {};
  for (const [date, d] of Object.entries(map)) {
    out[date] = {
      f0: avg(d.f0),
      cpp: avg(d.cpp),
      jitter: avg(d.jitter),
      shimmer: avg(d.shimmer),
      breaks: avg(d.breaks),
      count: d.count,
      massage: state.massageDays.includes(date),
    };
  }
  return out;
}

function avg(a) {
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

// 전체 초기화 (디버그/사용자 요청용)
export function clearAll() {
  state = { records: [], massageDays: [], target: null };
  save(state);
}
