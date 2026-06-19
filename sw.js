// sw.js — 오프라인 지원 서비스워커
// 전략: 같은 출처(앱 코드/HTML)는 "네트워크 우선" → 온라인이면 항상 최신,
//       오프라인일 때만 캐시로 폴백. 이렇게 하면 배포 후 새 버전이 바로 반영된다.
const CACHE = 'voice-analysis-v5';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/dsp.js',
  './js/fft.js',
  './js/recorder.js',
  './js/explain.js',
  './js/charts.js',
  './js/store.js',
  './js/massage.js',
  './js/biofeedback.js',
  './js/dashboard.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // 오프라인 첫 사용을 위한 사전 캐시 후 즉시 활성화
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 자원은 기본 처리

  // 네트워크 우선, 실패(오프라인) 시 캐시 폴백
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
