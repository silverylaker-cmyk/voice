// dsp.js — 음성 분석용 신호처리 알고리즘 모음
// 제공 기능:
//   - resample()          : 분석 속도를 위한 다운샘플링
//   - yinPitch()          : YIN 알고리즘 기반 단일 프레임 F0 추정
//   - analyzeSustained()  : 지속 모음 → F0 / Jitter / Shimmer
//   - cppFrame()          : 프레임 단위 Cepstral Peak Prominence
//   - analyzeSpeech()     : 발화 → SFF 분포 / CPP / Pitch Breaks

import { fft, ifft, nextPow2 } from './fft.js';

// 분석에 사용할 표준 표본화율 (음성 F0 < 500Hz 이므로 충분, 계산량 절감)
export const ANALYSIS_SR = 16000;

// 음성 F0 탐색 범위 (Hz)
export const F0_MIN = 60;
export const F0_MAX = 500;

// ---------------------------------------------------------------------------
// 선형 보간 리샘플링
// ---------------------------------------------------------------------------
export function resample(input, srIn, srOut) {
  if (srIn === srOut) return input.slice(0);
  const ratio = srIn / srOut;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0];
    const b = i0 + 1 < input.length ? input[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 윈도우 함수
// ---------------------------------------------------------------------------
function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

// ---------------------------------------------------------------------------
// YIN 피치 검출 (단일 프레임)
// 반환: { f0, periodSamples, aperiodicity }  (무성/검출 실패 시 f0 = 0)
// ---------------------------------------------------------------------------
export function yinPitch(frame, sr, threshold = 0.15) {
  const n = frame.length;
  const tauMax = Math.min(Math.floor(sr / F0_MIN), Math.floor(n / 2));
  const tauMin = Math.max(Math.floor(sr / F0_MAX), 2);

  // 1) 차분 함수 d(tau)
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tauMax; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // 2) 누적 평균 정규화 차분 함수 d'(tau)
  const dPrime = new Float64Array(tauMax + 1);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
  }

  // 3) 절대 임계값 — 임계값 아래로 처음 떨어지는 지역 최소를 탐색
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dPrime[tau] < threshold) {
      while (tau + 1 <= tauMax && dPrime[tau + 1] < dPrime[tau]) tau++;
      tauEst = tau;
      break;
    }
  }

  // 임계값 미달이면 전역 최소를 차선책으로 사용
  if (tauEst === -1) {
    let minVal = Infinity, minTau = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dPrime[tau] < minVal) { minVal = dPrime[tau]; minTau = tau; }
    }
    // 비주기성이 너무 높으면 무성으로 판정
    if (minVal > 0.6 || minTau < 0) {
      return { f0: 0, periodSamples: 0, aperiodicity: 1 };
    }
    tauEst = minTau;
  }

  // 4) 포물선 보간으로 정밀 주기 추정
  let betterTau = tauEst;
  if (tauEst > tauMin && tauEst < tauMax) {
    const s0 = dPrime[tauEst - 1];
    const s1 = dPrime[tauEst];
    const s2 = dPrime[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }

  const f0 = sr / betterTau;
  const aperiodicity = dPrime[tauEst];
  if (f0 < F0_MIN || f0 > F0_MAX) {
    return { f0: 0, periodSamples: 0, aperiodicity: 1 };
  }
  return { f0, periodSamples: betterTau, aperiodicity };
}

// ---------------------------------------------------------------------------
// 프레임별 F0/에너지 컨투어 추출
// 반환: { f0[], rms[], voiced[], times[], hop, frameSize }
// ---------------------------------------------------------------------------
export function pitchContour(signal, sr, frameMs = 40, hopMs = 10) {
  const frameSize = Math.round((frameMs / 1000) * sr);
  const hop = Math.round((hopMs / 1000) * sr);
  const win = hann(frameSize);
  const nFrames = Math.max(0, 1 + Math.floor((signal.length - frameSize) / hop));

  const f0 = new Float64Array(nFrames);
  const rms = new Float64Array(nFrames);
  const aper = new Float64Array(nFrames);
  const voiced = new Uint8Array(nFrames);
  const times = new Float64Array(nFrames);

  const frame = new Float64Array(frameSize);

  // 무성 판정을 위한 에너지 기준선 계산용
  let maxRms = 0;

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = signal[start + i];
      frame[i] = s * win[i];
      energy += s * s;
    }
    const frameRms = Math.sqrt(energy / frameSize);
    rms[f] = frameRms;
    if (frameRms > maxRms) maxRms = frameRms;
    times[f] = (start + frameSize / 2) / sr;

    const { f0: pitch, aperiodicity } = yinPitch(frame, sr);
    f0[f] = pitch;
    aper[f] = aperiodicity;
  }

  // 에너지 게이트: 최대 RMS의 일정 비율 이하 프레임은 무성으로 처리
  const rmsGate = maxRms * 0.04;
  for (let f = 0; f < nFrames; f++) {
    voiced[f] = f0[f] > 0 && rms[f] > rmsGate && aper[f] < 0.45 ? 1 : 0;
  }

  return { f0, rms, aper, voiced, times, hop, frameSize, nFrames };
}

// ---------------------------------------------------------------------------
// 지속 모음 분석: F0 / Jitter / Shimmer
// 입력은 분석 표본화율(ANALYSIS_SR)로 리샘플된 신호
// ---------------------------------------------------------------------------
export function analyzeSustained(signal, sr) {
  // 1) 안정 구간 선택 — 에너지 컨투어로 가장 안정적인 가운데 부분 사용
  const contour = pitchContour(signal, sr, 40, 10);
  const voicedF0 = [];
  for (let f = 0; f < contour.nFrames; f++) {
    if (contour.voiced[f]) voicedF0.push(contour.f0[f]);
  }

  if (voicedF0.length < 5) {
    return { ok: false, reason: 'voiced_too_short' };
  }

  const meanF0 = mean(voicedF0);
  const sdF0 = std(voicedF0, meanF0);

  // 2) 주기 마커(글로탈 펄스) 추출 — peak-picking 기반 point process
  // 평균 주기를 기준으로 양의 피크를 탐색해 주기/진폭열을 만든다.
  const periodSamples = sr / meanF0;
  const marks = extractPeaks(signal, sr, meanF0);

  if (marks.length < 6) {
    return { ok: false, reason: 'cycles_too_few', meanF0 };
  }

  // 3) 주기열과 진폭열
  const periods = [];
  const amps = [];
  for (let i = 1; i < marks.length; i++) {
    const T = (marks[i].idx - marks[i - 1].idx) / sr; // 초 단위 주기
    periods.push(T);
  }
  for (let i = 0; i < marks.length; i++) amps.push(marks[i].amp);

  // 비정상적으로 벗어난 주기(연결 오류) 제거: 중앙값의 0.5~2배 범위만 사용
  const medT = median(periods);
  const cleanPeriods = periods.filter((t) => t > medT * 0.5 && t < medT * 2);

  // 4) Jitter
  // local jitter (%) = 평균 |Ti - Ti-1| / 평균 T × 100
  const jitterLocal = relativeMeanAbsDiff(cleanPeriods) * 100;
  // ppq5: 5점 이동평균 기반 (보다 안정적)
  const jitterPPQ5 = ppq(cleanPeriods, 5) * 100;
  // absolute jitter (마이크로초)
  const jitterAbs = meanAbsDiff(cleanPeriods) * 1e6;

  // 5) Shimmer
  // local shimmer (%) = 평균 |Ai - Ai-1| / 평균 A × 100
  const shimmerLocal = relativeMeanAbsDiff(amps) * 100;
  // dB shimmer = 평균 |20·log10(Ai/Ai-1)|
  const shimmerDB = shimmerInDb(amps);
  // apq5
  const shimmerAPQ5 = ppq(amps, 5) * 100;

  return {
    ok: true,
    meanF0,
    sdF0,
    minF0: Math.min(...voicedF0),
    maxF0: Math.max(...voicedF0),
    cycles: cleanPeriods.length,
    jitterLocal,
    jitterPPQ5,
    jitterAbs,
    shimmerLocal,
    shimmerDB,
    shimmerAPQ5,
    durationSec: signal.length / sr,
  };
}

// 평균 주기를 기준으로 양의 피크를 찾아 글로탈 펄스 후보를 만든다.
function extractPeaks(signal, sr, meanF0) {
  const period = Math.round(sr / meanF0);
  const minDist = Math.round(period * 0.6); // 너무 가까운 피크 억제
  const marks = [];
  let i = 1;
  const n = signal.length;
  let lastIdx = -minDist;
  while (i < n - 1) {
    // 지역 최대
    if (signal[i] > signal[i - 1] && signal[i] >= signal[i + 1] && signal[i] > 0) {
      if (i - lastIdx >= minDist) {
        // 주변에서 진짜 최대 위치 보정
        let bestIdx = i, bestVal = signal[i];
        const lo = Math.max(0, i - 2), hi = Math.min(n - 1, i + 2);
        for (let j = lo; j <= hi; j++) {
          if (signal[j] > bestVal) { bestVal = signal[j]; bestIdx = j; }
        }
        marks.push({ idx: bestIdx, amp: bestVal });
        lastIdx = bestIdx;
        i = bestIdx + minDist;
        continue;
      }
    }
    i++;
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Cepstral Peak Prominence (단일 프레임)
// 실수 켑스트럼을 구하고 F0 대역(quefrency)의 피크 돌출도를 회귀선 대비로 측정
// 반환: cpp 값(dB), 검출 실패 시 null
// ---------------------------------------------------------------------------
export function cppFrame(frame, sr) {
  const n0 = frame.length;
  const N = nextPow2(n0);

  // 윈도우 적용 + 제로패딩
  const win = hann(n0);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < n0; i++) re[i] = frame[i] * win[i];

  // FFT → 로그 크기 스펙트럼
  fft(re, im);
  const logMag = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    logMag[i] = Math.log(mag + 1e-12);
  }

  // 로그 스펙트럼의 IFFT → 실수 켑스트럼
  const cre = new Float64Array(N);
  const cim = new Float64Array(N);
  for (let i = 0; i < N; i++) cre[i] = logMag[i];
  ifft(cre, cim);
  // 켑스트럼 크기 (quefrency 영역)
  const ceps = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    ceps[i] = Math.sqrt(cre[i] * cre[i] + cim[i] * cim[i]);
  }

  // dB 켑스트럼
  const cepsDb = new Float64Array(N);
  for (let i = 0; i < N; i++) cepsDb[i] = 20 * Math.log10(ceps[i] + 1e-12);

  // F0 대역에 해당하는 quefrency 범위
  const qMin = Math.floor(sr / F0_MAX);
  const qMax = Math.min(Math.ceil(sr / F0_MIN), N / 2 - 1);
  if (qMax <= qMin + 2) return null;

  // 회귀선: qMin..qMax 구간의 켑스트럼에 대한 최소제곱 직선
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, cnt = 0;
  for (let q = qMin; q <= qMax; q++) {
    sumX += q; sumY += cepsDb[q]; sumXY += q * cepsDb[q]; sumXX += q * q; cnt++;
  }
  const denom = cnt * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (cnt * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / cnt;

  // 피크 탐색 및 회귀선 대비 돌출도
  let peakQ = -1, peakVal = -Infinity;
  for (let q = qMin; q <= qMax; q++) {
    if (cepsDb[q] > peakVal) { peakVal = cepsDb[q]; peakQ = q; }
  }
  if (peakQ < 0) return null;
  const regAtPeak = slope * peakQ + intercept;
  const cpp = peakVal - regAtPeak;
  const f0 = sr / peakQ;
  return { cpp, f0 };
}

// ---------------------------------------------------------------------------
// 발화 분석: SFF 분포 / CPP / Pitch Breaks
// ---------------------------------------------------------------------------
export function analyzeSpeech(signal, sr) {
  const contour = pitchContour(signal, sr, 40, 10);
  const { f0, voiced, rms, times, nFrames } = contour;

  // 1) 유성 F0 수집 (SFF)
  const voicedF0 = [];
  for (let f = 0; f < nFrames; f++) {
    if (voiced[f]) voicedF0.push(f0[f]);
  }
  if (voicedF0.length < 20) {
    return { ok: false, reason: 'speech_too_short' };
  }

  const meanSFF = mean(voicedF0);
  const medianSFF = median(voicedF0);
  const sdSFF = std(voicedF0, meanSFF);
  const minSFF = Math.min(...voicedF0);
  const maxSFF = Math.max(...voicedF0);
  // 반음(semitone) 표준편차 — 음도 변동성 지표
  const semitones = voicedF0.map((x) => 12 * Math.log2(x / medianSFF));
  const sdST = std(semitones, mean(semitones));

  // 히스토그램 (10Hz 빈)
  const binW = 10;
  const lo = Math.floor(minSFF / binW) * binW;
  const hi = Math.ceil(maxSFF / binW) * binW;
  const nbins = Math.max(1, Math.round((hi - lo) / binW));
  const hist = new Array(nbins).fill(0);
  for (const v of voicedF0) {
    let b = Math.floor((v - lo) / binW);
    if (b < 0) b = 0;
    if (b >= nbins) b = nbins - 1;
    hist[b]++;
  }
  const histogram = hist.map((count, i) => ({
    from: lo + i * binW,
    to: lo + (i + 1) * binW,
    count,
  }));

  // 2) CPP — 유성 프레임마다 계산해 평균
  const frameSize = contour.frameSize;
  const hop = contour.hop;
  const win = hann(frameSize);
  const cppVals = [];
  const frame = new Float64Array(frameSize);
  for (let f = 0; f < nFrames; f++) {
    if (!voiced[f]) continue;
    const start = f * hop;
    for (let i = 0; i < frameSize; i++) frame[i] = signal[start + i];
    const r = cppFrame(frame, sr);
    if (r && isFinite(r.cpp)) cppVals.push(r.cpp);
  }
  const meanCPP = cppVals.length ? mean(cppVals) : null;
  const sdCPP = cppVals.length ? std(cppVals, meanCPP) : null;

  // 3) Pitch Breaks — 인접 유성 프레임 간 음도 급변 + 발성 중 끊김
  // 정의:
  //   (a) 옥타브성 도약: 연속한 두 유성 프레임에서 F0 비가 1.5배 초과/이하이고,
  //       새 음높이가 최소 3프레임(30ms) 이상 유지될 때(F0 추정 단발 오류 배제).
  //   (b) 발성 중단: "이어지던 발성"이 짧게 끊겼다 같은 음높이로 복귀하는 경우.
  //       (무성 자음 ㅍ/ㅌ/ㅋ 과 구분하기 위해 양쪽 음높이 유사 + 충분한 길이 요구)
  const hopSec = hop / sr;

  let octaveJumps = 0;
  for (let f = 1; f < nFrames; f++) {
    if (!(voiced[f] && voiced[f - 1])) continue;
    const ratio = f0[f] / f0[f - 1];
    if (ratio <= 1.5 && ratio >= 1 / 1.5) continue;
    // 새 음높이가 일정 프레임 유지되는지(단발 옥타브 오류 배제)
    let stable = 0;
    for (let k = f; k < Math.min(nFrames, f + 3); k++) {
      if (voiced[k] && Math.abs(f0[k] / f0[f] - 1) < 0.2) stable++;
    }
    if (stable >= 3) octaveJumps++;
  }

  // 유성 구간 분할
  const segments = [];
  let s = -1;
  for (let f = 0; f < nFrames; f++) {
    if (voiced[f] && s < 0) s = f;
    if (!voiced[f] && s >= 0) { segments.push([s, f - 1]); s = -1; }
  }
  if (s >= 0) segments.push([s, nFrames - 1]);

  // 발성 중단: 충분히 길게(>=120ms) 이어지던 두 유성 구간이 짧은 갭(60~200ms)으로
  // 끊기고, 갭 전후 F0가 유사(±15%)하면 "발성 중 끊김"으로 간주한다.
  let voiceBreaks = 0;
  for (let i = 1; i < segments.length; i++) {
    const gapFrames = segments[i][0] - segments[i - 1][1] - 1;
    const gapSec = gapFrames * hopSec;
    const prevLen = (segments[i - 1][1] - segments[i - 1][0] + 1) * hopSec;
    const curLen = (segments[i][1] - segments[i][0] + 1) * hopSec;
    if (prevLen < 0.12 || curLen < 0.12) continue;
    if (gapSec < 0.06 || gapSec > 0.2) continue;
    const fPrev = f0[segments[i - 1][1]];
    const fCur = f0[segments[i][0]];
    if (fPrev > 0 && Math.abs(fCur / fPrev - 1) <= 0.15) voiceBreaks++;
  }

  const totalBreaks = octaveJumps + voiceBreaks;

  // 전체 분석 길이 및 유성 시간
  const totalSec = signal.length / sr;
  const voicedSec = voicedF0.length * hopSec;
  const breaksPerMin = totalSec > 0 ? totalBreaks / (totalSec / 60) : 0;

  return {
    ok: true,
    meanSFF,
    medianSFF,
    sdSFF,
    sdST,
    minSFF,
    maxSFF,
    histogram,
    meanCPP,
    sdCPP,
    octaveJumps,
    voiceBreaks,
    totalBreaks,
    breaksPerMin,
    durationSec: totalSec,
    voicedSec,
    voicedRatio: voicedSec / totalSec,
    // 시각화용 컨투어 (다운샘플)
    contour: buildContourForPlot(times, f0, voiced),
  };
}

function buildContourForPlot(times, f0, voiced) {
  const pts = [];
  const stride = Math.max(1, Math.floor(times.length / 1200));
  for (let i = 0; i < times.length; i += stride) {
    pts.push({ t: times[i], f0: voiced[i] ? f0[i] : null });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// 통계 보조 함수
// ---------------------------------------------------------------------------
function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}
function std(a, m) {
  if (a.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
  return Math.sqrt(s / (a.length - 1));
}
function median(a) {
  if (!a.length) return 0;
  const b = Array.from(a).sort((x, y) => x - y);
  const mid = Math.floor(b.length / 2);
  return b.length % 2 ? b[mid] : (b[mid - 1] + b[mid]) / 2;
}
function meanAbsDiff(a) {
  if (a.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
  return s / (a.length - 1);
}
function relativeMeanAbsDiff(a) {
  const m = mean(a);
  if (m === 0) return 0;
  return meanAbsDiff(a) / m;
}
// PPQ/APQ: k점 이동평균 대비 변동
function ppq(a, k) {
  if (a.length < k) return 0;
  const half = Math.floor(k / 2);
  const m = mean(a);
  if (m === 0) return 0;
  let s = 0, cnt = 0;
  for (let i = half; i < a.length - half; i++) {
    let avg = 0;
    for (let j = -half; j <= half; j++) avg += a[i + j];
    avg /= k;
    s += Math.abs(a[i] - avg);
    cnt++;
  }
  return cnt ? (s / cnt) / m : 0;
}
function shimmerInDb(a) {
  if (a.length < 2) return 0;
  let s = 0, cnt = 0;
  for (let i = 1; i < a.length; i++) {
    if (a[i] > 0 && a[i - 1] > 0) {
      s += Math.abs(20 * Math.log10(a[i] / a[i - 1]));
      cnt++;
    }
  }
  return cnt ? s / cnt : 0;
}
