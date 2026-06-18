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

  // 2) 글로탈 펄스 마커 추출 — 피치 컨투어 유도 + 교차상관(cross-correlation) 보정
  //    (Praat의 point-process(cc) 방식에 준한다: 이전 주기 파형과 가장 닮은 위치를 찾음)
  const f0AtSample = (idx) => {
    const f = Math.round((idx - contour.frameSize / 2) / contour.hop);
    if (f >= 0 && f < contour.nFrames && contour.voiced[f] && contour.f0[f] > 0) {
      return contour.f0[f];
    }
    return meanF0;
  };
  // 가장 긴 연속 유성 구간을 분석 대상으로 사용 (무성/잡음 구간 배제)
  const vr = longestVoicedRange(contour);
  const startIdx = vr ? vr[0] * contour.hop : 0;
  const endIdx = vr
    ? Math.min(signal.length, (vr[1] + 1) * contour.hop + contour.frameSize)
    : signal.length;

  const marks = pointProcess(signal, sr, f0AtSample, startIdx, endIdx);
  if (marks.length < 6) {
    return { ok: false, reason: 'cycles_too_few', meanF0 };
  }

  // 3) 주기열(초)과 진폭열 — 주기는 서브샘플 위치(pos)로 계산
  const periods = [];
  for (let i = 1; i < marks.length; i++) periods.push((marks[i].pos - marks[i - 1].pos) / sr);
  const amps = marks.map((m) => m.amp);

  // 유효 주기 범위(초): F0 탐색 범위에 대응
  const pFloor = 1 / F0_MAX, pCeil = 1 / F0_MIN;

  // 4) Jitter — Praat식 제약: 범위 밖 주기 제외 + 연속 주기비 1.3 초과 쌍 제외
  const jitterLocal = constrainedRelDiff(periods, pFloor, pCeil, MAX_PERIOD_FACTOR) * 100;
  const jitterAbs = constrainedAbsDiff(periods, pFloor, pCeil, MAX_PERIOD_FACTOR) * 1e6;
  const inRangePeriods = periods.filter((t) => t >= pFloor && t <= pCeil);
  const jitterPPQ5 = ppq(inRangePeriods, 5) * 100;

  // 5) Shimmer — Praat식 제약: 연속 진폭비 1.6 초과 쌍 제외
  const shimmerLocal = constrainedRelDiff(amps, 0, Infinity, MAX_AMP_FACTOR) * 100;
  const shimmerDB = constrainedShimmerDb(amps, MAX_AMP_FACTOR);
  const shimmerAPQ5 = ppq(amps, 5) * 100;

  const cyclesUsed = inRangePeriods.length;

  // 6) CPPS — 지속 모음의 음질 지표 (세션1에도 추가)
  const { meanCPPS, sdCPPS } = meanCPPSOverVoiced(signal, sr, contour);

  return {
    ok: true,
    meanF0,
    sdF0,
    minF0: Math.min(...voicedF0),
    maxF0: Math.max(...voicedF0),
    cycles: cyclesUsed,
    jitterLocal,
    jitterPPQ5,
    jitterAbs,
    shimmerLocal,
    shimmerDB,
    shimmerAPQ5,
    meanCPPS,
    sdCPPS,
    durationSec: signal.length / sr,
  };
}

// Praat point-process 제약 상수
const MAX_PERIOD_FACTOR = 1.3; // 연속 주기비가 이를 넘으면 jitter 계산에서 제외
const MAX_AMP_FACTOR = 1.6;    // 연속 진폭비가 이를 넘으면 shimmer 계산에서 제외

// 가장 긴 연속 유성 구간 [startFrame, endFrame]
function longestVoicedRange(contour) {
  let best = null, bestLen = 0, s = -1;
  for (let f = 0; f < contour.nFrames; f++) {
    const v = contour.voiced[f];
    if (v && s < 0) s = f;
    if ((!v || f === contour.nFrames - 1) && s >= 0) {
      const e = v ? f : f - 1;
      if (e - s + 1 > bestLen) { bestLen = e - s + 1; best = [s, e]; }
      s = -1;
    }
  }
  return best;
}

// [lo,hi) 구간에서 절대값이 최대인 표본 위치
function argMaxAbs(signal, lo, hi) {
  let bi = lo, bv = -1;
  for (let i = lo; i < hi; i++) {
    const v = Math.abs(signal[i]);
    if (v > bv) { bv = v; bi = i; }
  }
  return bi;
}

// center 주변 ±halfWin 구간의 피크(절대값 최대) 진폭.
// (피크 형태가 포물선이 아니어서 서브샘플 보간은 오히려 잡음을 키우므로 정수 최대 사용)
function periodPeakAmp(signal, center, halfWin) {
  const n = signal.length;
  const lo = Math.max(0, center - halfWin);
  const hi = Math.min(n - 1, center + halfWin);
  let mv = 0;
  for (let i = lo; i <= hi; i++) { const v = Math.abs(signal[i]); if (v > mv) mv = v; }
  return mv;
}

// p 위치의 한 주기 윈도와 후보 c 위치를 정규화 교차상관으로 비교한다.
// 정수 최적 위치 c와, 상관함수의 포물선 보간으로 구한 서브샘플 위치 pos를 반환.
// (서브샘플 보간이 없으면 ±1샘플 양자화로 인한 지터 바닥이 생긴다.)
function bestCCorr(signal, p, lo, hi, win) {
  const half = Math.floor(win / 2);
  const n = signal.length;
  const corr = new Float64Array(hi - lo + 1);
  let bestC = lo, bestR = -Infinity;
  for (let c = lo; c <= hi; c++) {
    let dot = 0, e1 = 0, e2 = 0;
    for (let k = -half; k <= half; k++) {
      const ia = p + k, ib = c + k;
      const a = ia >= 0 && ia < n ? signal[ia] : 0;
      const b = ib >= 0 && ib < n ? signal[ib] : 0;
      dot += a * b; e1 += a * a; e2 += b * b;
    }
    const r = dot / (Math.sqrt(e1 * e2) + 1e-12);
    corr[c - lo] = r;
    if (r > bestR) { bestR = r; bestC = c; }
  }
  // 서브샘플 보간 (상관 최대 주변 3점 포물선)
  let frac = 0;
  const bi = bestC - lo;
  if (bi > 0 && bi < corr.length - 1) {
    const rm = corr[bi - 1], r0 = corr[bi], rp = corr[bi + 1];
    const denom = rm - 2 * r0 + rp;
    if (denom !== 0) {
      frac = (0.5 * (rm - rp)) / denom;
      if (frac > 1) frac = 1; else if (frac < -1) frac = -1;
    }
  }
  return { c: bestC, pos: bestC + frac };
}

// 피치 컨투어로 예측한 주기를 교차상관으로 보정하며 글로탈 펄스 마커를 생성.
// idx: 정수 위치(진폭 측정·다음 탐색 기준), pos: 서브샘플 위치(주기 계산)
function pointProcess(signal, sr, f0AtSample, start, end) {
  const marks = [];
  const T0 = sr / f0AtSample(start);
  let p = argMaxAbs(signal, start, Math.min(end, start + Math.round(T0)));
  marks.push({ idx: p, pos: p, amp: periodPeakAmp(signal, p, Math.round(T0 / 4)) });

  let guard = 0;
  while (guard++ < 200000) {
    const T = sr / f0AtSample(p);
    const predicted = p + T;
    if (predicted + T * 0.5 >= end) break;
    const lo = Math.max(p + 2, Math.round(predicted - T * 0.35));
    const hi = Math.min(end - 1, Math.round(predicted + T * 0.35));
    if (hi <= lo) break;
    const win = Math.max(8, Math.round(T * 0.8));
    const { c, pos } = bestCCorr(signal, p, lo, hi, win);
    if (c <= p) break;
    marks.push({ idx: c, pos, amp: periodPeakAmp(signal, c, Math.round(T / 4)) });
    p = c;
  }
  return marks;
}

// 범위 제약 + 비율 제약을 적용한 상대 평균 절대차 (jitter local / shimmer local)
function constrainedRelDiff(vals, floor, ceil, maxFactor) {
  let sumV = 0, nV = 0;
  for (const v of vals) if (v >= floor && v <= ceil && v > 0) { sumV += v; nV++; }
  if (nV === 0) return 0;
  const meanV = sumV / nV;
  let sumD = 0, nD = 0;
  for (let i = 1; i < vals.length; i++) {
    const a = vals[i - 1], b = vals[i];
    if (a < floor || a > ceil || b < floor || b > ceil || a <= 0 || b <= 0) continue;
    if (Math.max(a, b) / Math.min(a, b) > maxFactor) continue;
    sumD += Math.abs(b - a); nD++;
  }
  return nD ? (sumD / nD) / meanV : 0;
}

// 범위/비율 제약을 적용한 절대 평균 차 (jitter absolute, 초 단위)
function constrainedAbsDiff(vals, floor, ceil, maxFactor) {
  let sumD = 0, nD = 0;
  for (let i = 1; i < vals.length; i++) {
    const a = vals[i - 1], b = vals[i];
    if (a < floor || a > ceil || b < floor || b > ceil) continue;
    if (Math.max(a, b) / Math.min(a, b) > maxFactor) continue;
    sumD += Math.abs(b - a); nD++;
  }
  return nD ? sumD / nD : 0;
}

// 진폭비 제약을 적용한 dB shimmer
function constrainedShimmerDb(amps, maxFactor) {
  let sumD = 0, nD = 0;
  for (let i = 1; i < amps.length; i++) {
    const a = amps[i - 1], b = amps[i];
    if (a <= 0 || b <= 0) continue;
    if (Math.max(a, b) / Math.min(a, b) > maxFactor) continue;
    sumD += Math.abs(20 * Math.log10(b / a)); nD++;
  }
  return nD ? sumD / nD : 0;
}

// ---------------------------------------------------------------------------
// CPPS — Smoothed Cepstral Peak Prominence
// 로그파워 스펙트럼의 실수 켑스트럼을 quefrency·시간으로 평활한 뒤,
// F0 대역 피크를 전체 quefrency 회귀선 대비 돌출도(dB)로 측정한다.
// (raw CPP보다 잡음이 적고 임상 CPPS 정의에 가깝다.)
// ---------------------------------------------------------------------------

// 한 프레임의 dB 켑스트럼(quefrency 0..N/2) 계산
function frameCepstrumDb(signal, start, frameSize, N, win) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < frameSize; i++) re[i] = (signal[start + i] || 0) * win[i];
  fft(re, im);
  // 로그 파워 스펙트럼
  for (let i = 0; i < N; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = Math.log(p + 1e-12);
    im[i] = 0;
  }
  ifft(re, im); // 실수 켑스트럼 → re
  const half = N >> 1;
  const cdb = new Float64Array(half + 1);
  for (let q = 0; q <= half; q++) cdb[q] = 20 * Math.log10(Math.abs(re[q]) + 1e-12);
  return cdb;
}

// 1차원 이동평균 (폭 W)
function movingAvg1D(arr, W) {
  const n = arr.length;
  const out = new Float64Array(n);
  const half = W >> 1;
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) { s += arr[j]; c++; }
    out[i] = s / c;
  }
  return out;
}

// 평활된 켑스트럼에서 CPP(dB) 계산
function cppFromCepstrum(cdb, qLow, qRegHi, qpLo, qpHi) {
  let sx = 0, sy = 0, sxy = 0, sxx = 0, n = 0;
  for (let q = qLow; q <= qRegHi; q++) {
    sx += q; sy += cdb[q]; sxy += q * cdb[q]; sxx += q * q; n++;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return NaN;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let peakQ = -1, peakVal = -Infinity;
  for (let q = qpLo; q <= qpHi; q++) {
    if (cdb[q] > peakVal) { peakVal = cdb[q]; peakQ = q; }
  }
  if (peakQ < 0) return NaN;
  return peakVal - (slope * peakQ + intercept);
}

// 프레임별 CPPS 컨투어 (시간 평활은 링 버퍼로 메모리 절약)
// 반환: Float64Array(nFrames), 계산 불가 프레임은 NaN
function cppsPerFrame(signal, sr, frameSize, hop, nFrames) {
  const N = nextPow2(frameSize);
  const half = N >> 1;
  const win = hann(frameSize);
  const qLow = Math.max(2, Math.round(sr * 0.001));   // ~1ms 이상(저-quefrency 기울기 제외)
  const qRegHi = half - 1;                             // 회귀선: 전체 quefrency
  const qpLo = Math.max(qLow + 1, Math.floor(sr / F0_MAX));
  const qpHi = Math.min(half - 1, Math.ceil(sr / F0_MIN));
  const Wt = 7, halfT = Wt >> 1, Wq = 11;              // 시간·quefrency 평활 폭
  const ring = [];
  const out = new Float64Array(nFrames).fill(NaN);
  if (qpHi <= qpLo + 2) return out;

  for (let f = 0; f < nFrames; f++) {
    const raw = frameCepstrumDb(signal, f * hop, frameSize, N, win);
    ring.push(movingAvg1D(raw, Wq));
    if (ring.length > Wt) ring.shift();
    if (ring.length === Wt) {
      const mean = new Float64Array(half + 1);
      for (let q = 0; q <= qRegHi; q++) {
        let s = 0;
        for (let t = 0; t < Wt; t++) s += ring[t][q];
        mean[q] = s / Wt;
      }
      out[f - halfT] = cppFromCepstrum(mean, qLow, qRegHi, qpLo, qpHi);
    }
  }
  return out;
}

// 유성 프레임의 평균 CPPS (지속 모음·발화 공용)
function meanCPPSOverVoiced(signal, sr, contour) {
  const cpps = cppsPerFrame(signal, sr, contour.frameSize, contour.hop, contour.nFrames);
  const vals = [];
  for (let f = 0; f < contour.nFrames; f++) {
    if (contour.voiced[f] && !Number.isNaN(cpps[f])) vals.push(cpps[f]);
  }
  if (!vals.length) return { meanCPPS: null, sdCPPS: null, cpps };
  const m = mean(vals);
  return { meanCPPS: m, sdCPPS: std(vals, m), cpps };
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

  // 2) CPPS — 평활 켑스트럼 피크 돌출도 (유성 프레임 평균)
  const { meanCPPS, sdCPPS } = meanCPPSOverVoiced(signal, sr, contour);
  const hop = contour.hop;

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
    meanCPPS,
    sdCPPS,
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
