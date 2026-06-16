// fft.js — Radix-2 Cooley-Tukey FFT (in-place), 순수 자바스크립트 구현.
// 음성 신호의 스펙트럼/켑스트럼 분석에 사용한다.

// 길이 n(2의 거듭제곱)에 대한 비트 반전 순열과 트위들 인자를 미리 계산해 캐싱한다.
const cache = new Map();

function getPlan(n) {
  let plan = cache.get(n);
  if (plan) return plan;

  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT 길이는 2의 거듭제곱이어야 합니다: ' + n);
  }

  // 비트 반전 인덱스
  const rev = new Uint32Array(n);
  let bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }

  // 단계별 트위들 인자 (cos, sin)
  const cosT = new Float64Array(n / 2);
  const sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const ang = (-2 * Math.PI * i) / n;
    cosT[i] = Math.cos(ang);
    sinT[i] = Math.sin(ang);
  }

  plan = { n, rev, cosT, sinT };
  cache.set(n, plan);
  return plan;
}

// 복소수 FFT (제자리 연산). re, im 은 Float64Array.
export function fft(re, im) {
  const n = re.length;
  const plan = getPlan(n);
  const { rev, cosT, sinT } = plan;

  // 비트 반전 재배열
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  // 버터플라이
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cosT[k];
        const s = sinT[k];
        const a = i + j;
        const b = a + half;
        const tre = re[b] * c - im[b] * s;
        const tim = re[b] * s + im[b] * c;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

// 역 FFT (제자리). 결과는 실수부에 들어간다(정규화 포함).
export function ifft(re, im) {
  const n = re.length;
  // conj → fft → conj → scale
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] = re[i] / n;
    im[i] = -im[i] / n;
  }
}

// 다음 2의 거듭제곱
export function nextPow2(x) {
  return Math.pow(2, Math.ceil(Math.log2(x)));
}
