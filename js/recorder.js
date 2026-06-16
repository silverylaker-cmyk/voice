// recorder.js — Web Audio API 기반 마이크 녹음
// 원시 Float32 PCM 샘플을 모아 분석에 사용한다.

export class Recorder {
  constructor() {
    this.audioContext = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.chunks = [];
    this.recording = false;
    this.sampleRate = 0;
    this.onLevel = null;   // 입력 레벨 콜백 (0~1)
    this.onTime = null;    // 경과 시간 콜백 (초)
    this._startTime = 0;
    this._timer = null;
  }

  async start() {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    // iOS 등에서 정지 상태일 수 있으므로 재개
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.sampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // ScriptProcessor 사용 (호환성 우선). 버퍼 4096.
    const bufferSize = 4096;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.chunks = [];
    this.recording = true;

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      if (this.onLevel) {
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const v = Math.abs(input[i]);
          if (v > peak) peak = v;
        }
        this.onLevel(peak);
      }
    };

    this.source.connect(this.processor);
    // 일부 브라우저는 destination 연결이 있어야 onaudioprocess가 동작
    this.processor.connect(this.audioContext.destination);

    this._startTime = performance.now();
    if (this.onTime) {
      this._timer = setInterval(() => {
        this.onTime((performance.now() - this._startTime) / 1000);
      }, 200);
    }
  }

  stop() {
    if (!this.recording) return null;
    this.recording = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }

    try { this.processor.disconnect(); } catch (e) {}
    try { this.source.disconnect(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());

    const sr = this.sampleRate;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) { merged.set(c, off); off += c.length; }
    this.chunks = [];

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    return { samples: merged, sampleRate: sr };
  }

  get elapsedSec() {
    return this.recording ? (performance.now() - this._startTime) / 1000 : 0;
  }
}
