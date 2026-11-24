// Webcam + MediaPipe HandLandmarker wrapper.
// All assets are served locally from /vendor with parallel background preloading & live progress.
import { classify, analyzeHand, GestureStabilizer, Gesture } from './gestures.js?v=6';

const VENDOR = new URL('../vendor/mediapipe-0.10.18/', import.meta.url).href;
const MODEL_URL = `${VENDOR}models/hand_landmarker.task`;
// Uncompressed byte sizes for smooth progress even when Nginx serves gzip-compressed streams
const EXPECTED_BYTES = { wasm: 9_502_124, model: 7_819_105 };

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const LABEL = {
  [Gesture.OPEN]: '✋ 张开手掌 · 散开',
  [Gesture.FIST]: '✊ 握拳 · 聚合',
  [Gesture.OK]: '👌 OK · 看照片',
  [Gesture.PEACE]: '✌️ 比耶 · 看祝福书签',
  [Gesture.NONE]: '🤚 已识别到手',
};

async function fetchStream(url, expectedBytes, onBytes) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`模型资源加载失败 (${res.status})`);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(expectedBytes);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onBytes(Math.min(received, expectedBytes));
  }
  onBytes(expectedBytes);
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

export class HandTracker {
  constructor({ video, canvas, label, onUpdate }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.label = label;
    this.onUpdate = onUpdate;
    this.stabilizer = new GestureStabilizer(4);
    this.running = false;
    this.starting = false;
    this.sessionId = 0;
    this.landmarker = null;
    this.loadPromise = null;
    this.loadPercent = 0;
    this.loadStage = 'idle'; // idle | downloading | init | ready
    this.progressListeners = new Set();
    this.stream = null;
    this.lastVideoTime = -1;
    this.lostFrames = 0;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  }

  onProgress(fn) {
    this.progressListeners.add(fn);
    fn(this.loadPercent, this.loadStage);
    return () => this.progressListeners.delete(fn);
  }

  _emitProgress(pct, stage) {
    this.loadPercent = pct;
    this.loadStage = stage;
    for (const fn of this.progressListeners) fn(pct, stage);
  }

  /** Begin downloading & initializing MediaPipe in parallel in the background (idempotent). */
  preload() {
    if (this.landmarker) return Promise.resolve(this.landmarker);
    if (this.loadPromise) return this.loadPromise;

    this._emitProgress(1, 'downloading');
    this.loadPromise = (async () => {
      try {
        let wasmDone = 0;
        let modelDone = 0;
        const total = EXPECTED_BYTES.wasm + EXPECTED_BYTES.model;
        const report = () => {
          const pct = Math.min(99, Math.max(1, Math.round(((wasmDone + modelDone) / total) * 100)));
          this._emitProgress(pct, 'downloading');
        };

        // Start downloading the 7.8MB model immediately while resolving the exact SIMD/no-SIMD WASM fileset
        const modelPromise = fetchStream(MODEL_URL, EXPECTED_BYTES.model, (n) => { modelDone = n; report(); });
        const { FilesetResolver, HandLandmarker } = await import(`${VENDOR}vision_bundle.mjs`);
        const fileset = await FilesetResolver.forVisionTasks(`${VENDOR}wasm`);

        // Warm the browser's immutable cache for exact WASM loader + binary in parallel with the model download
        const [, , modelBytes] = await Promise.all([
          fetch(fileset.wasmLoaderPath, { cache: 'force-cache' }).then((r) => r.arrayBuffer()).catch(() => null),
          fetchStream(fileset.wasmBinaryPath, EXPECTED_BYTES.wasm, (n) => { wasmDone = n; report(); }),
          modelPromise,
        ]);

        this._emitProgress(100, 'init');
        const makeOpts = (delegate) => ({
          // Slice gives a clean copy so GPU -> CPU fallback never reuses a neutered buffer
          baseOptions: { modelAssetBuffer: modelBytes.slice(), delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        try {
          this.landmarker = await HandLandmarker.createFromOptions(fileset, makeOpts('GPU'));
        } catch (e) {
          console.warn('GPU delegate failed, falling back to CPU', e);
          this.landmarker = await HandLandmarker.createFromOptions(fileset, makeOpts('CPU'));
        }
        this._emitProgress(100, 'ready');
        return this.landmarker;
      } catch (e) {
        this.loadPromise = null;
        this._emitProgress(0, 'idle');
        throw e;
      }
    })();

    return this.loadPromise;
  }

  async start() {
    if (this.starting || this.running) return false;
    if (!HandTracker.supported()) {
      throw new Error(window.isSecureContext ? '当前浏览器不支持摄像头' : '需要通过 HTTPS 访问才能使用摄像头');
    }

    this.starting = true;
    const sid = ++this.sessionId;

    // Kick off / attach to model loading immediately in parallel with camera permission prompt
    const unsub = this.onProgress((pct, stage) => {
      if (sid !== this.sessionId) return;
      if (stage === 'downloading') this.label.textContent = `加载手势模型 ${pct}%…`;
      else if (stage === 'init') this.label.textContent = '初始化手势引擎…';
    });
    const modelReady = this.preload();

    let stream = null;
    try {
      this.label.textContent = this.landmarker ? '请求摄像头权限…' : `请求摄像头 / 模型 ${this.loadPercent}%…`;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (sid !== this.sessionId) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch (playErr) {
        if (sid !== this.sessionId || playErr?.name === 'AbortError') return false;
        throw playErr;
      }

      if (!this.landmarker) {
        this.label.textContent = this.loadStage === 'init' ? '初始化手势引擎…' : `加载手势模型 ${this.loadPercent}%…`;
        await modelReady;
      }
      if (sid !== this.sessionId) return false;
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (sid === this.sessionId) {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.video.srcObject = null;
      }
      if (sid !== this.sessionId) return false;
      throw e;
    } finally {
      unsub();
      if (sid === this.sessionId) this.starting = false;
    }

    this.label.textContent = '请把手举到镜头前';
    this.running = true;
    this.loop();
    return true;
  }

  stop() {
    this.sessionId++;
    this.starting = false;
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.stabilizer.reset();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onUpdate?.({ present: false, gesture: Gesture.NONE });
  }

  loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const res = this.landmarker.detectForVideo(v, performance.now());
      this.handle(res?.landmarks?.[0]);
    }
    requestAnimationFrame(this.loop);
  };

  handle(lm) {
    const c = this.canvas;
    if (c.width !== this.video.videoWidth) { c.width = this.video.videoWidth; c.height = this.video.videoHeight; }
    this.ctx.clearRect(0, 0, c.width, c.height);
    if (!lm) {
      if (++this.lostFrames > 6) {
        this.stabilizer.reset();
        this.label.textContent = '请把手举到镜头前';
        this.onUpdate?.({ present: false, gesture: Gesture.NONE });
      }
      return;
    }
    this.lostFrames = 0;
    const raw = classify(lm);
    const gesture = this.stabilizer.push(raw);
    const info = analyzeHand(lm);
    this.draw(lm, gesture);
    this.label.textContent = LABEL[gesture];
    this.onUpdate?.({ present: true, gesture, palm: { x: 1 - info.palm.x, y: info.palm.y } });
  }

  draw(lm, gesture) {
    const { ctx, canvas: c } = this;
    const color = gesture === Gesture.OK
      ? '#ff6b81'
      : gesture === Gesture.PEACE
        ? '#c9a6ff'
        : gesture === Gesture.OPEN
          ? '#7dffb2'
          : '#ffd27a';
    ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.fillStyle = '#fff';
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(lm[a].x * c.width, lm[a].y * c.height);
      ctx.lineTo(lm[b].x * c.width, lm[b].y * c.height);
    }
    ctx.stroke();
    for (const p of lm) {
      ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.height, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
