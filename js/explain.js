// explain.js — 측정값을 일반인이 이해할 수 있게 해석/설명한다.
// 참고 기준치는 정상 성인 음성 문헌(Praat/임상음성학)의 일반적 범위를 따른다.
// ※ 의학적 진단이 아니라 참고용 해설이다.

// 등급 → 색상 키
export const LEVEL = { GOOD: 'good', MILD: 'mild', WARN: 'warn' };

// 결과 표시 토글 — 코드는 유지하되 화면 노출만 제어한다.
// 다시 보이게 하려면 해당 값을 true 로 바꾸면 된다.
export const SHOW = {
  shimmer: false,      // 세션1 쉬머 카드 + 대시보드 쉬머 그래프
  pitchBreaks: false,  // 세션2 음도 일탈 카드
};

function pick(value, goodMax, mildMax) {
  if (value <= goodMax) return LEVEL.GOOD;
  if (value <= mildMax) return LEVEL.MILD;
  return LEVEL.WARN;
}

// ---- 지속 모음(검사 모드) ----
export function explainSustained(r) {
  const items = [];

  // F0 — 성별 일반 범위 참고치
  let f0Note;
  const f = r.meanF0;
  if (f < 100) f0Note = '성인 남성의 일반 범위(약 85~180Hz)에서 낮은 편입니다.';
  else if (f < 180) f0Note = '성인 남성의 일반 범위(약 85~180Hz)에 해당합니다.';
  else if (f < 255) f0Note = '성인 여성의 일반 범위(약 165~255Hz)에 해당합니다.';
  else f0Note = '평균보다 상당히 높은 음높이입니다.';
  items.push({
    key: 'F0 (기본 주파수)',
    value: `${f.toFixed(1)} Hz`,
    sub: `변동 ±${r.sdF0.toFixed(1)} Hz · 범위 ${r.minF0.toFixed(0)}~${r.maxF0.toFixed(0)} Hz`,
    level: LEVEL.GOOD,
    desc:
      '성대가 1초에 진동하는 횟수로, 목소리의 높낮이를 결정합니다. ' + f0Note,
  });

  // Jitter (local) — 정상 < 1.04% (Praat 기준)
  const jLevel = pick(r.jitterLocal, 1.04, 2.0);
  items.push({
    key: 'Jitter (지터, local)',
    value: `${r.jitterLocal.toFixed(2)} %`,
    sub: `PPQ5 ${r.jitterPPQ5.toFixed(2)}% · 절대 ${r.jitterAbs.toFixed(0)} µs`,
    level: jLevel,
    desc:
      '연속한 성대 진동 주기가 서로 얼마나 들쭉날쭉한지를 나타내는 "주파수 떨림"입니다. ' +
      '일반적으로 1.04% 이하를 정상으로 봅니다. ' +
      (jLevel === LEVEL.GOOD
        ? '안정적인 주기성을 보입니다.'
        : jLevel === LEVEL.MILD
        ? '약간의 불안정이 있습니다. 피로·건조·긴장 시 나타날 수 있습니다.'
        : '주기 변동이 큰 편입니다. 지속될 경우 음성 휴식과 전문가 상담을 권합니다.'),
  });

  // Shimmer (local) — 정상 < 3.81%, dB < 0.35  (현재 화면 비표시: SHOW.shimmer)
  if (SHOW.shimmer) {
    const sLevel = pick(r.shimmerLocal, 3.81, 6.0);
    items.push({
      key: 'Shimmer (쉬머, local)',
      value: `${r.shimmerLocal.toFixed(2)} %`,
      sub: `${r.shimmerDB.toFixed(2)} dB · APQ5 ${r.shimmerAPQ5.toFixed(2)}%`,
      level: sLevel,
      desc:
        '연속한 진동의 "세기(진폭)"가 얼마나 들쭉날쭉한지를 나타내는 떨림입니다. ' +
        '일반적으로 3.81%(또는 0.35dB) 이하를 정상으로 봅니다. ' +
        (sLevel === LEVEL.GOOD
          ? '진폭이 고르게 유지됩니다.'
          : sLevel === LEVEL.MILD
          ? '약간의 진폭 흔들림이 있습니다. 거친 느낌(조조성)이 들 수 있습니다.'
          : '진폭 변동이 큰 편입니다. 쉰 목소리·바람 새는 느낌과 관련될 수 있습니다.'),
    });
  }

  // CPPS — 지속 모음의 음질 지표 (모음은 대략 ≥9 양호, <6 주의)
  if (r.meanCPPS != null) {
    const cLevel = r.meanCPPS >= 9 ? LEVEL.GOOD : r.meanCPPS >= 6 ? LEVEL.MILD : LEVEL.WARN;
    items.push({
      key: 'CPPS (평활 켑스트럼 피크 돌출도)',
      value: `${r.meanCPPS.toFixed(2)} dB`,
      sub: `변동 ±${(r.sdCPPS ?? 0).toFixed(2)} dB`,
      level: cLevel,
      desc:
        '모음 발성의 주기성이 얼마나 뚜렷한지를 나타내는 음질 지표입니다. ' +
        '값이 높을수록 맑고 또렷하며, 낮을수록 쉰·바람 새는 음성에 가깝습니다. ' +
        (cLevel === LEVEL.GOOD
          ? '뚜렷하고 건강한 음질입니다.'
          : cLevel === LEVEL.MILD
          ? '보통 수준의 음질입니다.'
          : '음질 저하 가능성이 있습니다.'),
    });
  }

  // 종합
  const worst = items
    .map((i) => i.level)
    .reduce((a, b) => (rank(b) > rank(a) ? b : a), LEVEL.GOOD);
  const summary =
    worst === LEVEL.GOOD
      ? '전반적으로 안정적이고 건강한 음성 특성을 보입니다.'
      : worst === LEVEL.MILD
      ? '대체로 양호하나 일부 지표에서 가벼운 불안정이 관찰됩니다. 충분한 수분 섭취와 음성 휴식이 도움이 됩니다.'
      : '일부 지표가 일반 기준을 벗어났습니다. 증상이 지속되면 이비인후과·음성언어재활 전문가 상담을 권합니다.';

  return { items, summary, level: worst };
}

// ---- 발화 평가 모드 ----
export function explainSpeech(r) {
  const items = [];

  // SFF 분포
  items.push({
    key: 'SFF (발화 기본 주파수)',
    value: `평균 ${r.meanSFF.toFixed(1)} Hz`,
    sub: `중앙값 ${r.medianSFF.toFixed(1)} Hz · 변동 ±${r.sdSFF.toFixed(1)} Hz (${r.sdST.toFixed(1)} semitone)`,
    level: LEVEL.GOOD,
    desc:
      '일상 대화에서 실제로 사용한 목소리 높이의 평균과 분포입니다. ' +
      '아래 막대그래프는 어떤 음높이를 얼마나 자주 사용했는지 보여줍니다. ' +
      `음높이 변동폭이 약 ${r.sdST.toFixed(1)} 반음으로, ` +
      (r.sdST >= 2 && r.sdST <= 4
        ? '자연스러운 억양 변화 범위입니다.'
        : r.sdST < 2
        ? '비교적 단조로운(평탄한) 억양입니다.'
        : '억양 변화가 큰 편입니다.'),
  });

  // CPPS — 평활 켑스트럼 피크 돌출도 (발화: 대략 ≥7 양호, <4 주의)
  if (r.meanCPPS != null) {
    const cLevel = r.meanCPPS >= 7 ? LEVEL.GOOD : r.meanCPPS >= 4 ? LEVEL.MILD : LEVEL.WARN;
    items.push({
      key: 'CPPS (평활 켑스트럼 피크 돌출도)',
      value: `${r.meanCPPS.toFixed(2)} dB`,
      sub: `변동 ±${(r.sdCPPS ?? 0).toFixed(2)} dB`,
      level: cLevel,
      desc:
        '목소리의 주기성이 얼마나 뚜렷한지를 나타내는, 전반적 음질을 가장 잘 반영하는 지표입니다 ' +
        '(시간·quefrency로 평활한 CPPS). 값이 높을수록 맑고 또렷하며, 낮을수록 쉰 목소리·바람 새는 음성에 가깝습니다. ' +
        (cLevel === LEVEL.GOOD
          ? '뚜렷하고 건강한 음질을 보입니다.'
          : cLevel === LEVEL.MILD
          ? '보통 수준의 음질입니다. 피로하거나 음성을 많이 쓴 날 낮아질 수 있습니다.'
          : '음질 저하 가능성이 있습니다. 증상이 지속되면 전문가 상담을 권합니다.'),
    });
  }

  // Pitch Breaks (현재 화면 비표시: SHOW.pitchBreaks)
  if (SHOW.pitchBreaks) {
    const bLevel = r.breaksPerMin <= 3 ? LEVEL.GOOD : r.breaksPerMin <= 8 ? LEVEL.MILD : LEVEL.WARN;
    items.push({
      key: '음도 일탈 (Pitch Breaks)',
      value: `${r.totalBreaks}회`,
      sub: `분당 ${r.breaksPerMin.toFixed(1)}회 · 음높이 급변 ${r.octaveJumps} / 발성 끊김 ${r.voiceBreaks}`,
      level: bLevel,
      desc:
        '말하는 도중 음높이가 갑자기 튀거나(옥타브성 도약) 발성이 순간적으로 끊기는 현상입니다. ' +
        '음성 피로나 성대 불안정에서 늘어날 수 있습니다. ' +
        (bLevel === LEVEL.GOOD
          ? '음도가 안정적으로 잘 유지되고 있습니다.'
          : bLevel === LEVEL.MILD
          ? '간헐적인 음도 일탈이 있습니다. 음성 사용량이 많을 때 나타날 수 있습니다.'
          : '음도 일탈이 잦은 편입니다. 음성 휴식과 함께 지속 시 전문가 상담을 권합니다.'),
    });
  }

  // 분석 메타
  items.push({
    key: '분석 정보',
    value: `${formatDuration(r.durationSec)}`,
    sub: `유성 구간 ${(r.voicedRatio * 100).toFixed(0)}% (${formatDuration(r.voicedSec)})`,
    level: LEVEL.GOOD,
    desc: '전체 녹음 길이와, 그중 실제로 목소리를 낸(유성) 구간의 비율입니다.',
  });

  // 표시되는 모든 항목으로 종합 등급 산출(숨긴 지표는 영향 없음, 메타는 GOOD이라 무해)
  const worst = items
    .map((i) => i.level)
    .reduce((a, b) => (rank(b) > rank(a) ? b : a), LEVEL.GOOD);

  const summary =
    worst === LEVEL.GOOD
      ? '일상 발화에서 기본 주파수가 안정적으로 유지되고 음질도 양호합니다.'
      : worst === LEVEL.MILD
      ? '대체로 양호하지만 일부 구간에서 음도/음질의 가벼운 불안정이 관찰됩니다. 규칙적인 음성 휴식이 도움이 됩니다.'
      : '발화 중 음도 또는 음질의 불안정이 두드러집니다. 증상이 반복되면 음성 전문가 상담을 권합니다.';

  return { items, summary, level: worst };
}

function rank(level) {
  return level === LEVEL.WARN ? 2 : level === LEVEL.MILD ? 1 : 0;
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// ---- 종합 해석: 세션1 지터 × 세션2 CPPS ----
// 지터(짧은 구간 주파수 떨림)와 CPPS(전반적 음질·주기성)는 서로 보완적이어서
// 두 축으로 함께 보면 음성 상태를 더 정확히 분류할 수 있다.
export function explainCombined(jitterPct, cppsDb) {
  const jitterHigh = jitterPct > 1.04;   // 지터 정상 상한
  const cppsLow = cppsDb < 7;            // 발화 CPPS 양호 기준
  const cppsVeryLow = cppsDb < 4;

  let level, headline, advice;
  if (!jitterHigh && !cppsLow) {
    level = LEVEL.GOOD;
    headline = '주기 안정성(지터)과 전반 음질(CPPS)이 모두 양호합니다.';
    advice = '현재 음성 상태가 건강한 편입니다. 좋은 발성 습관을 유지하세요.';
  } else if (jitterHigh && !cppsLow) {
    level = LEVEL.MILD;
    headline = '전반 음질(CPPS)은 양호하나, 짧은 구간의 주파수 떨림(지터)이 큽니다.';
    advice = '일시적 피로·긴장·건조에서 잘 나타납니다. 수분 섭취·음성 휴식 후 재측정을 권합니다.';
  } else if (!jitterHigh && cppsLow) {
    level = cppsVeryLow ? LEVEL.WARN : LEVEL.MILD;
    headline = '주기는 비교적 규칙적이나, 전반 음질(CPPS)이 낮습니다.';
    advice = 'CPPS는 전반적 음질을 잘 반영하는 지표로, 낮으면 기식성(바람 새는)·잡음 섞인 음성일 수 있습니다. 지속되면 전문가 평가를 권합니다.';
  } else {
    level = LEVEL.WARN;
    headline = '주기 불안정(지터↑)과 음질 저하(CPPS↓)가 함께 나타납니다.';
    advice = '음성 부담이 큰 패턴입니다. 음성 휴식과 함께 이비인후과·음성언어재활 전문가 상담을 권합니다.';
  }

  return {
    key: '종합 해석 (지터 × CPPS)',
    value: `지터 ${jitterPct.toFixed(2)}% · CPPS ${cppsDb.toFixed(1)}dB`,
    sub: '세션1 지터 × 세션2 CPPS 조합',
    level,
    desc:
      '지터는 짧은 구간의 "주파수 떨림", CPPS는 "전반적 음질·주기성"을 나타내는 보완적 지표입니다. ' +
      '함께 보면 음성 상태를 더 정확히 파악할 수 있습니다. ' + headline + ' ' + advice,
  };
}
