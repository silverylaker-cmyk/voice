// massage.js — 세션3: 후두 마사지 (Manual Circumlaryngeal Therapy)
// 설명 슬라이드 + 시연 영상 → 따라하기 → 세션1 검사 재시행 → 마사지 전/후 비교

import { drawBeforeAfter } from './charts.js';

// 후두 주변 해부 구조를 간단히 그린 SVG (목 측면)
function neckSVG(highlight) {
  const hi = (id) => (highlight === id ? '#e0457b' : '#cdd7e8');
  return `<svg viewBox="0 0 200 200" class="anat">
    <path d="M70 10 q-10 60 0 110 q5 40 30 70" fill="none" stroke="#e9d3c4" stroke-width="22" stroke-linecap="round"/>
    <ellipse cx="92" cy="78" rx="20" ry="10" fill="${hi('hyoid')}"/>
    <text x="118" y="80" font-size="11" fill="#7a8699">설골</text>
    <rect x="74" y="92" width="40" height="30" rx="8" fill="${hi('thyroid')}"/>
    <text x="118" y="110" font-size="11" fill="#7a8699">갑상연골</text>
    <ellipse cx="94" cy="132" rx="18" ry="9" fill="${hi('cricoid')}"/>
    <text x="118" y="135" font-size="11" fill="#7a8699">윤상연골</text>
    <circle cx="60" cy="78" r="6" fill="${highlight ? '#5b8def' : 'none'}"/>
    <circle cx="60" cy="105" r="6" fill="${highlight ? '#5b8def' : 'none'}"/>
  </svg>`;
}

const SLIDES = [
  {
    title: '후두 마사지란?',
    svg: neckSVG(null),
    body: `목 주변(후두) 근육이 과도하게 긴장하면 목소리가 쉬거나 음높이가
    불안정해질 수 있습니다. <b>후두 도수치료(MCT)</b>는 손으로 후두 주변
    근육을 부드럽게 풀어 음성을 편하게 내도록 돕는 기법입니다.`,
    tip: '⚠️ 통증·어지럼이 있으면 즉시 멈추세요. 전문 치료를 대체하지 않습니다.',
  },
  {
    title: '1단계 — 준비',
    svg: neckSVG(null),
    body: `편하게 앉아 어깨의 힘을 빼고 턱을 살짝 당깁니다. 거울을 보며
    목 앞쪽 가운데의 단단한 <b>갑상연골(목젖)</b>을 손끝으로 가볍게 확인합니다.
    숨을 천천히 내쉬며 긴장을 풉니다.`,
    tip: '손은 따뜻하게, 압력은 "기분 좋은 정도"로만.',
  },
  {
    title: '2단계 — 설골 마사지',
    svg: neckSVG('hyoid'),
    body: `갑상연골 위쪽의 <b>설골</b> 부위를 엄지와 검지로 부드럽게 감싸고,
    작은 <b>원을 그리듯</b> 좌우로 10~15초간 마사지합니다. 근육이 풀리는
    느낌에 집중하세요.`,
    tip: '“음~” 하고 콧소리를 내며 하면 이완에 도움이 됩니다.',
  },
  {
    title: '3단계 — 갑상설골 공간',
    svg: neckSVG('thyroid'),
    body: `설골과 갑상연골 <b>사이의 홈(공간)</b>을 따라 손끝으로 좌우로
    부드럽게 문지릅니다. 이 공간이 좁고 단단하면 긴장이 높다는 신호입니다.
    10~15초간 천천히 풀어줍니다.`,
    tip: '한쪽씩 번갈아 가며, 호흡을 멈추지 마세요.',
  },
  {
    title: '4단계 — 후두 하강 유도',
    svg: neckSVG('cricoid'),
    body: `갑상연골의 양 측면을 엄지·검지로 가볍게 잡고, <b>아주 약한 힘으로
    살짝 아래로</b> 내리듯 유도합니다. 동시에 편안한 “아~” 소리를 내며
    후두가 내려가 음성이 편해지는 감각을 느낍니다.`,
    tip: '절대 세게 누르지 말 것. 가볍게, 반복적으로.',
  },
  {
    title: '5단계 — 발성과 마무리',
    svg: neckSVG(null),
    body: `마사지를 유지한 채 편안한 음높이로 “아~”, “마~” 를 여러 번
    발성합니다. 목소리가 한결 가볍고 편하게 나오는지 확인하며 마무리합니다.
    전체 과정을 <b>2~3분</b> 반복하세요.`,
    tip: '충분히 이완됐다면, 아래에서 검사를 다시 해 효과를 확인하세요.',
  },
];

export function renderMassage(panel, api) {
  panel.innerHTML = '';

  const intro = document.createElement('div');
  intro.className = 'guide';
  intro.innerHTML = `<h2>후두 마사지 (MCT)</h2>
    <p>아래 <b>설명 슬라이드</b>와 <b>시연 영상</b>을 본 뒤, 영상을 다시 보며
    천천히 따라 해보세요. 충분히 마사지했다면 세션1 검사를 다시 진행해
    <b>마사지 전·후를 비교</b>합니다.</p>`;
  panel.appendChild(intro);

  // ── 슬라이드 카루셀 ──
  let idx = 0;
  const slideCard = document.createElement('div');
  slideCard.className = 'card slide-card';
  slideCard.innerHTML = `
    <div class="slide-body"></div>
    <div class="slide-nav">
      <button class="slide-btn" data-dir="-1">‹ 이전</button>
      <div class="slide-dots"></div>
      <button class="slide-btn" data-dir="1">다음 ›</button>
    </div>`;
  panel.appendChild(slideCard);
  const slideBody = slideCard.querySelector('.slide-body');
  const dots = slideCard.querySelector('.slide-dots');

  function renderSlide() {
    const s = SLIDES[idx];
    slideBody.innerHTML = `
      <div class="slide-illust">${s.svg}</div>
      <div class="slide-text">
        <div class="slide-step">${idx + 1} / ${SLIDES.length}</div>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
        <div class="slide-tip">${s.tip}</div>
      </div>`;
    dots.innerHTML = SLIDES.map((_, i) =>
      `<span class="dot ${i === idx ? 'on' : ''}"></span>`).join('');
  }
  slideCard.querySelectorAll('.slide-btn').forEach((b) =>
    b.addEventListener('click', () => {
      idx = (idx + Number(b.dataset.dir) + SLIDES.length) % SLIDES.length;
      renderSlide();
    }));
  renderSlide();

  // ── 시연 영상 ──
  const videoCard = document.createElement('div');
  videoCard.className = 'card';
  videoCard.innerHTML = `
    <div class="card-key">시연 영상</div>
    <video id="mct-video" class="mct-video" controls playsinline preload="metadata"
      poster="./icons/icon-512.png">
      <source src="./assets/mct-demo.mp4" type="video/mp4" />
    </video>
    <div id="video-fallback" class="video-fallback" hidden>
      <p>📹 기본 시연 영상이 아직 없습니다. 보유한 마사지 시연 영상 파일을
      불러오면 여기서 재생됩니다.</p>
      <label class="file-btn">동영상 파일 선택
        <input type="file" id="video-file" accept="video/*" hidden />
      </label>
    </div>
    <p class="card-sub">영상을 한 번 본 뒤, <b>다시 재생하며 천천히 따라 해보세요.</b></p>`;
  panel.appendChild(videoCard);

  const video = videoCard.querySelector('#mct-video');
  const fallback = videoCard.querySelector('#video-fallback');
  const fileInput = videoCard.querySelector('#video-file');
  video.addEventListener('error', () => {
    video.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    video.src = url;
    video.hidden = false;
    fallback.hidden = true;
    video.play().catch(() => {});
  });

  // ── 따라하기 / 검사 다시하기 선택 ──
  const actions = document.createElement('div');
  actions.className = 'card massage-actions';
  actions.innerHTML = `
    <div class="card-key">마사지를 진행하셨나요?</div>
    <p class="card-sub">영상을 다시 보며 따라 한 뒤, 충분히 마사지했다면 검사를 다시 해보세요.</p>
    <div class="action-row">
      <button class="btn-secondary" id="btn-follow">▶ 영상 다시 보며 따라하기</button>
      <button class="btn-primary" id="btn-retest">충분히 했어요 — 검사 다시하기</button>
    </div>
    <div id="massage-note" class="massage-note"></div>`;
  panel.appendChild(actions);

  const note = actions.querySelector('#massage-note');
  const before = api.getLatestVowel();
  if (!before) {
    note.innerHTML = `ℹ️ 비교할 <b>마사지 전 검사 결과</b>가 없습니다.
      먼저 <b>세션1(음성 검사)</b>에서 “아~” 검사를 1회 진행하면,
      그 결과가 마사지 전 기준으로 사용됩니다.`;
  } else {
    note.innerHTML = `✔ 마사지 전 기준: ${new Date(before.ts).toLocaleString('ko-KR')}
      측정 (F0 ${before.f0.toFixed(1)}Hz)`;
  }

  actions.querySelector('#btn-follow').addEventListener('click', () => {
    video.hidden = false;
    video.currentTime = 0;
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    video.play().catch(() => {});
  });

  actions.querySelector('#btn-retest').addEventListener('click', () => {
    api.addMassageDay();
    api.requestVowelRetest((afterResult) => {
      renderComparison(panel, before, afterResult, api);
    });
  });
}

// 마사지 전/후 비교 결과 렌더링
export function renderComparison(panel, before, after, api) {
  // 결과 영역(공용 #results)에 그린다
  const box = document.getElementById('results');
  box.innerHTML = '';
  box.classList.add('show');

  // 타겟 F0 저장 (세션4 바이오피드백 가이드로 사용)
  const semis = 2;
  const lowF0 = after.meanF0 * Math.pow(2, -semis / 12);
  const highF0 = after.meanF0 * Math.pow(2, semis / 12);
  api.setTarget({ meanF0: after.meanF0, lowF0, highF0 });

  if (!before) {
    const warn = document.createElement('div');
    warn.className = 'summary lv-mild';
    warn.innerHTML = `<div class="summary-badge">안내</div>
      <div class="summary-text">마사지 전 기준 결과가 없어 절대 비교는 생략합니다.
      이번 결과를 기준으로 저장했습니다. 다음 마사지 때 전·후가 비교됩니다.</div>`;
    box.appendChild(warn);
  }

  const beforeF0 = before ? before.f0 : null;
  const dF0 = before ? after.meanF0 - beforeF0 : null;
  const dJit = before ? after.jitterLocal - before.jitter : null;
  const dShim = before ? after.shimmerLocal - before.shimmer : null;

  // 종합 배너
  const improved = before && (dJit < 0 || dShim < 0);
  const banner = document.createElement('div');
  banner.className = 'summary ' + (improved ? 'lv-good' : 'lv-mild');
  banner.innerHTML = `<div class="summary-badge">마사지 후</div>
    <div class="summary-text">${
      before
        ? (improved
            ? '마사지 후 음성 안정성 지표(지터/쉬머)가 개선되었습니다. 변화를 아래에서 확인하세요.'
            : '마사지 전·후 변화를 아래에서 확인하세요. 한 번으로 큰 변화가 없을 수 있으며, 꾸준한 반복이 중요합니다.')
        : '마사지 후 검사를 완료했습니다.'
    }</div>`;
  box.appendChild(banner);

  // 비교 카드 (수치 + 변화량)
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-key">마사지 전 · 후 비교</div>`;
  const rows = [
    ['F0 (기본 주파수)', beforeF0, after.meanF0, 'Hz', false],
    ['Jitter (지터)', before?.jitter, after.jitterLocal, '%', true],
    ['Shimmer (쉬머)', before?.shimmer, after.shimmerLocal, '%', true],
  ];
  const tbl = document.createElement('div');
  tbl.className = 'cmp-table';
  tbl.innerHTML = `<div class="cmp-head"><span>항목</span><span>전</span><span>후</span><span>변화</span></div>` +
    rows.map(([label, b, a, unit, lowGood]) => {
      const delta = b != null ? a - b : null;
      let cls = 'flat', arrow = '–', txt = '';
      if (delta != null && Math.abs(delta) > 1e-6) {
        // 지터/쉬머는 감소가 개선(녹색), F0는 방향 자체로 좋고나쁨을 판단하지 않음
        const isGood = lowGood ? delta < 0 : true;
        cls = isGood ? 'down-good' : 'up-bad';
        arrow = delta < 0 ? '▼' : '▲';
        txt = `${arrow} ${Math.abs(delta).toFixed(2)}`;
      }
      return `<div class="cmp-row">
        <span>${label}</span>
        <span>${b != null ? b.toFixed(2) : '–'}</span>
        <span>${a.toFixed(2)}<small>${unit}</small></span>
        <span class="cmp-delta ${cls}">${b != null ? txt : '기준'}</span>
      </div>`;
    }).join('');
  card.appendChild(tbl);
  box.appendChild(card);

  // 막대 비교 차트
  if (before) {
    const chartCard = document.createElement('div');
    chartCard.className = 'card chart-card';
    chartCard.innerHTML = `<div class="card-key">전·후 비교 그래프</div>`;
    const cv = document.createElement('canvas');
    cv.className = 'chart';
    chartCard.appendChild(cv);
    box.appendChild(chartCard);
    drawBeforeAfter(cv, [
      { label: 'F0(Hz)', before: beforeF0, after: after.meanF0, unit: '', betterIsLow: false },
      { label: 'Jitter(%)', before: before.jitter, after: after.jitterLocal, unit: '', betterIsLow: true },
      { label: 'Shimmer(%)', before: before.shimmer, after: after.shimmerLocal, unit: '', betterIsLow: true },
    ]);
  }

  // 시간 추이 그래프 (이 항목의 모든 vowel 기록을 시간순으로)
  api.renderVowelTrend(box);

  // 타겟 안내
  const tcard = document.createElement('div');
  tcard.className = 'card lv-good';
  tcard.innerHTML = `<div class="card-key">🎯 바이오피드백 타겟 설정됨</div>
    <div class="card-desc">마사지 후 편안한 음높이 <b>${after.meanF0.toFixed(0)}Hz</b>
    (${lowF0.toFixed(0)}~${highF0.toFixed(0)}Hz)를 <b>세션4(실시간 바이오피드백)</b>의
    목표 음역대로 저장했습니다. 세션4에서 이 영역에 맞춰 말하는 연습을 할 수 있습니다.</div>`;
  box.appendChild(tcard);

  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
