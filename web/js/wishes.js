// 3D Christmas wish bookmarks with realistic top-eyelet pendulum sway, lagged gold tassel,
// smooth 3D arc fly-out inspection with cursor parallax, and lantern-like birth flight + stardust burst.
import * as THREE from 'three';
import { TREE, treeRadiusAt, rng, scatterPoint, blendPosition, damp, makeGlowTexture } from './util.js';

export const WISH_THEMES = {
  crimson:  { label: '圣诞红',   bg: ['#6b0d1a', '#b31b2c'], foil: '#f6d27c', text: '#fff7e8', accent: '#ffd88a' },
  emerald:  { label: '松柏绿',   bg: ['#0a3f26', '#167546'], foil: '#f3cb74', text: '#f4fff6', accent: '#ffe194' },
  gold:     { label: '香槟金',   bg: ['#64420d', '#b37f27'], foil: '#fff1c6', text: '#fffaf0', accent: '#fff2cc' },
  midnight: { label: '星夜蓝',   bg: ['#0d1c42', '#224486'], foil: '#ebd08a', text: '#eef5ff', accent: '#cfe4ff' },
  burgundy: { label: '酒红丝绒', bg: ['#450d2d', '#842054'], foil: '#f5cf86', text: '#fff2f7', accent: '#ffd4e5' },
};

const DEMO_WISHES = [
  { id: 'demo-1', demo: true, theme: 'crimson',  author: '圣诞老人', text: '愿你在这个冬天，被温暖和星光紧紧包围 ✨', t: 0 },
  { id: 'demo-2', demo: true, theme: 'emerald',  author: '匿名',     text: '平安喜乐，万事胜意，所求皆如愿 🎄', t: 0 },
  { id: 'demo-3', demo: true, theme: 'gold',     author: '星河旅人', text: '新的一年，愿好消息和雪花一起如约而至 ❄️', t: 0 },
  { id: 'demo-4', demo: true, theme: 'midnight', author: '匿名',     text: '点击右上角「写祝福」，把你的心愿挂到树上吧 🔖', t: 0 },
  { id: 'demo-5', demo: true, theme: 'burgundy', author: '冬日来信', text: '愿所有温柔与幸运，都在这棵树下相遇 🎁', t: 0 },
];

const MAX_3D_TAGS = 42;
const TAG_W = 0.56;
const TAG_H = 1.24;
const EYELET_PIVOT = TAG_H * 0.41; // offset so local y=0 aligns with the punched eyelet hole
const FOCUS_DIST = 5.1;
const FOCUS_FILL = 0.64;

function formatTime(ts) {
  if (!ts) return '圣诞示范签';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of [...text]) {
    const next = cur + ch;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.join('').length < text.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length > 1 ? last.slice(0, -1) : last) + '…';
  }
  return lines;
}

function makeBookmarkTexture(wish) {
  const th = WISH_THEMES[wish.theme] || WISH_THEMES.crimson;
  // High-DPI texture so the 3D bookmark is razor-sharp even up close in focus mode
  const W = 560, H = 1240;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const drawRibbonPath = (inset = 0) => {
    const l = 20 + inset, r = W - 20 - inset;
    const top = 28 + inset, shoulder = 136 + inset * 0.5;
    const bot = H - 32 - inset, notch = H - 122 - inset * 0.6;
    const cx = W / 2;
    g.beginPath();
    g.moveTo(cx - 96 + inset * 0.5, top);
    g.lineTo(cx + 96 - inset * 0.5, top);
    g.lineTo(r, shoulder);
    g.lineTo(r, bot);
    g.lineTo(cx, notch);
    g.lineTo(l, bot);
    g.lineTo(l, shoulder);
    g.closePath();
  };

  g.save();
  drawRibbonPath(0);
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, th.bg[0]);
  grd.addColorStop(0.5, th.bg[1]);
  grd.addColorStop(1, th.bg[0]);
  g.fillStyle = grd;
  g.fill();

  g.clip();
  // Soft warm spotlight sheen across the velvet paper
  const sheen = g.createRadialGradient(W * 0.35, H * 0.25, 20, W * 0.5, H * 0.45, H * 0.65);
  sheen.addColorStop(0, 'rgba(255,244,210,0.16)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);

  // Delicate golden paper flecks
  const rand = rng(wish.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 17));
  for (let i = 0; i < 65; i++) {
    g.fillStyle = `rgba(255,242,206,${0.05 + rand() * 0.14})`;
    g.beginPath();
    g.arc(rand() * W, rand() * H, 1.4 + rand() * 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Outer & inner double gold-foil border
  g.strokeStyle = th.foil;
  g.lineWidth = 6;
  drawRibbonPath(3);
  g.stroke();

  g.strokeStyle = 'rgba(255, 226, 154, 0.45)';
  g.lineWidth = 2.5;
  drawRibbonPath(22);
  g.stroke();

  // Punched eyelet with metallic gold grommet
  const cx = W / 2, holeY = 104;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(cx, holeY, 21, 0, Math.PI * 2); g.fill();
  g.restore();
  g.strokeStyle = th.foil;
  g.lineWidth = 7;
  g.beginPath(); g.arc(cx, holeY, 23, 0, Math.PI * 2); g.stroke();

  // Header & delicate gold divider
  g.fillStyle = th.foil;
  g.textAlign = 'center';
  g.font = '500 28px Georgia, "Times New Roman", serif';
  g.fillText('✦  CHRISTMAS WISH  ✦', cx, 212);
  g.strokeStyle = 'rgba(255, 224, 150, 0.36)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(106, 244); g.lineTo(W - 106, 244); g.stroke();

  // Adaptive typography so every wish (4..80 chars) reads cleanly in full without truncation
  const len = [...wish.text].length;
  const fontSize = len <= 22 ? 48 : len <= 46 ? 40 : 34;
  const lineH = Math.round(fontSize * 1.56);
  const maxLines = len <= 22 ? 6 : len <= 46 ? 8 : 11;
  g.fillStyle = th.text;
  g.font = `500 ${fontSize}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  const lines = wrapLines(g, wish.text, W - 124, maxLines);
  const blockH = (lines.length - 1) * lineH;
  const startY = Math.max(325, 590 - blockH / 2);
  lines.forEach((line, idx) => {
    g.fillText(line, cx, startY + idx * lineH);
  });

  // Bottom decorative divider, author & timestamp
  g.strokeStyle = 'rgba(255, 224, 150, 0.28)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(150, H - 252); g.lineTo(W - 150, H - 252); g.stroke();

  g.fillStyle = th.accent;
  g.font = '500 32px "PingFang SC","Microsoft YaHei",sans-serif';
  g.fillText(`— ${wish.author || '匿名'}`, cx, H - 204);

  g.fillStyle = 'rgba(255, 240, 210, 0.62)';
  g.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
  g.fillText(formatTime(wish.t), cx, H - 160);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SPARK_VERT = /* glsl */`
  uniform float uPixelRatio;
  attribute float aAlpha, aSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uPixelRatio * 48.0 / max(-mv.z, 2.0), 1.5, 18.0);
  }
`;
const SPARK_FRAG = /* glsl */`
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float g = exp(-d * d * 22.0) * vAlpha;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.48) * g * 1.3, g);
  }
`;

export class WishBookmarks {
  constructor(parent, { maxAnisotropy = 4 } = {}) {
    this.parent = parent;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.maxAnisotropy = maxAnisotropy;
    this.tags = [];
    this.allWishes = [];
    this.focusIndex = -1;
    this.lastShown = -1;
    this.clockTime = 0;

    this.planeGeo = new THREE.PlaneGeometry(TAG_W, TAG_H);
    this.cordGeo = new THREE.PlaneGeometry(0.015, 0.36);
    this.beadGeo = new THREE.SphereGeometry(0.032, 10, 8);
    this.tasselGeo = new THREE.ConeGeometry(0.044, 0.21, 10);
    this.cordMat = new THREE.MeshBasicMaterial({ color: '#f2c868', side: THREE.DoubleSide });
    this.tasselMat = new THREE.MeshStandardMaterial({
      color: '#f4c55b', emissive: '#593900', emissiveIntensity: 0.42, metalness: 0.75, roughness: 0.28,
    });
    this.haloTex = makeGlowTexture('rgba(255,222,135,0.85)', 'rgba(255,155,40,0)');

    this.pointerNDC = { x: 0, y: 0 };
    this.tilt = { x: 0, y: 0 };

    // Lightweight golden stardust burst pool for newly hung wishes
    this.sparks = [];
    this.buildSparkPool(40);

    this.tmp = {
      v: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
      q3: new THREE.Quaternion(), dir: new THREE.Vector3(), right: new THREE.Vector3(),
      up: new THREE.Vector3(), focusWorld: new THREE.Vector3(), focusLocal: new THREE.Vector3(),
      focusQ: new THREE.Quaternion(), arcVec: new THREE.Vector3(), tiltQ: new THREE.Quaternion(),
      birthPos: new THREE.Vector3(),
    };
  }

  get focused() { return this.focusIndex >= 0 && this.focusIndex < this.tags.length; }
  get focusedWish() { return this.focused ? this.tags[this.focusIndex].wish : null; }
  get count() { return this.tags.length; }

  buildSparkPool(n) {
    const pos = new Float32Array(n * 3);
    const alpha = new Float32Array(n);
    const size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.sparkGeo = g;
    this.sparkPts = new THREE.Points(g, mat);
    this.sparkPts.frustumCulled = false;
    this.group.add(this.sparkPts);
    for (let i = 0; i < n; i++) {
      this.sparks.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 99, life: 1, size: 1 });
    }
  }

  emitSparks(origin) {
    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i];
      const a = (i / this.sparks.length) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 0.65 + Math.random() * 1.45;
      sp.pos.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.25, -0.35 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.25));
      sp.vel.set(Math.cos(a) * spd, 0.45 + Math.random() * 1.35, Math.sin(a) * spd);
      sp.age = 0;
      sp.life = 1.2 + Math.random() * 1.1;
      sp.size = 0.7 + Math.random() * 0.9;
    }
  }

  setPointer(ndcX, ndcY) {
    this.pointerNDC.x = Math.max(-1, Math.min(1, ndcX));
    this.pointerNDC.y = Math.max(-1, Math.min(1, ndcY));
  }

  setWishes(list) {
    this.allWishes = list;
    const focusedId = this.focusedWish?.id || null;
    const wanted = (list.length ? list.slice(0, MAX_3D_TAGS) : DEMO_WISHES);
    const keep = new Set(wanted.map((w) => w.id));
    for (const tag of [...this.tags]) if (!keep.has(tag.id)) this.removeTag(tag);
    const have = new Set(this.tags.map((t) => t.id));
    for (const w of wanted) if (!have.has(w.id)) this.addTag(w);
    const order = new Map(wanted.map((w, i) => [w.id, i]));
    this.tags.sort((a, b) => order.get(a.id) - order.get(b.id));
    this.layout();
    this.focusIndex = focusedId ? this.tags.findIndex((t) => t.id === focusedId) : -1;
    if (this.lastShown >= this.tags.length) this.lastShown = -1;
  }

  addTag(wish) {
    const tex = makeBookmarkTexture(wish);
    tex.anisotropy = this.maxAnisotropy;
    const cardMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide,
    });

    // Root `mesh` sits at the top eyelet hanging point; `swing` pivots naturally from that eyelet!
    const mesh = new THREE.Group();
    const cord = new THREE.Mesh(this.cordGeo, this.cordMat);
    cord.position.y = 0.18;

    const swing = new THREE.Group();
    const card = new THREE.Mesh(this.planeGeo, cardMat);
    card.position.y = -EYELET_PIVOT;

    const haloMat = new THREE.SpriteMaterial({
      map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.14,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(1.35, 1.95, 1);
    halo.position.set(0, -EYELET_PIVOT, -0.045);

    // Secondary tassel pivot at the bottom swallowtail notch for realistic delayed sway
    const tasselPivot = new THREE.Group();
    tasselPivot.position.y = -TAG_H * 0.84;
    const bead = new THREE.Mesh(this.beadGeo, this.tasselMat);
    const tassel = new THREE.Mesh(this.tasselGeo, this.tasselMat);
    tassel.position.y = -0.11;
    tasselPivot.add(bead, tassel);

    swing.add(halo, card, tasselPivot);
    mesh.add(cord, swing);

    const tag = {
      id: wish.id, wish, mesh, swing, card, cord, tasselPivot,
      cardMat, haloMat, tex, scale: 1,
      focus: 0,          // 0 on tree/scatter .. 1 centered in front of camera
      landedAt: -10,     // triggers gentle settle pendulum after returning from focus
      birthStart: -10,   // lantern-like entrance animation start time
      birthSparked: true,
      swayPhase: Math.random() * Math.PI * 2,
    };
    card.userData.wishTag = tag;
    this.group.add(mesh);
    this.tags.push(tag);
  }

  removeTag(tag) {
    this.group.remove(tag.mesh);
    tag.tex.dispose();
    tag.cardMat.dispose();
    tag.haloMat.dispose();
    this.tags.splice(this.tags.indexOf(tag), 1);
  }

  layout() {
    const n = this.tags.length;
    const rand = rng(108);
    this.tags.forEach((tag, i) => {
      const h = 0.14 + (n > 1 ? i / (n - 1) : 0.45) * 0.68;
      const a = i * 2.39996 + 1.85;
      const r = treeRadiusAt(h) + 0.50;
      tag.tree = new THREE.Vector3(Math.cos(a) * r, TREE.baseY + h * TREE.height + EYELET_PIVOT, Math.sin(a) * r);
      tag.treeYaw = Math.atan2(tag.tree.x, tag.tree.z);
      tag.scatter = scatterPoint(rand, new THREE.Vector3(), 6.2, 12.6);
      tag.seed = 0.1 + rand() * 0.55;
      tag.scale = n > 28 ? 0.86 : 1.0;
    });
  }

  /** Trigger graceful rising lantern-flight entrance for a newly hung wish and return its yaw. */
  animateNewWish(id) {
    const tag = this.tags.find((t) => t.id === id);
    if (!tag) return null;
    tag.birthStart = this.clockTime;
    tag.birthSparked = false;
    return tag.treeYaw;
  }

  focusById(id) {
    let idx = this.tags.findIndex((t) => t.id === id);
    // If clicked an older wish (>42nd) from the wish wall, temporarily mount it so it flies out identically
    if (idx < 0) {
      const w = this.allWishes.find((item) => item.id === id);
      if (!w) return -1;
      this.addTag(w);
      this.layout();
      idx = this.tags.length - 1;
    }
    this._setFocus(idx);
    return idx;
  }

  showNext() {
    if (!this.tags.length) return -1;
    const next = (this.lastShown + 1) % this.tags.length;
    this._setFocus(next);
    return next;
  }

  stepFocus(delta) {
    if (!this.tags.length) return -1;
    const base = this.focused ? this.focusIndex : this.lastShown;
    const next = ((base < 0 ? 0 : base) + delta + this.tags.length) % this.tags.length;
    this._setFocus(next);
    return next;
  }

  unfocus() {
    if (this.focused) this.tags[this.focusIndex].landedAt = this.clockTime;
    this.focusIndex = -1;
  }

  _setFocus(idx) {
    if (this.focused && this.focusIndex !== idx) {
      this.tags[this.focusIndex].landedAt = this.clockTime;
    }
    this.focusIndex = idx;
    if (idx >= 0) this.lastShown = idx;
  }

  pickWish(raycaster) {
    const targets = this.tags.map((t) => t.card);
    const hits = raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].object.userData.wishTag.wish : null;
  }

  update(time, progress, dt, camera) {
    this.clockTime = time;
    const { v, q, q2, q3, dir, right, up, focusWorld, focusLocal, focusQ, arcVec, tiltQ, birthPos } = this.tmp;

    const parentInvQ = this.parent.getWorldQuaternion(q2).invert();
    const fovH = 2 * FOCUS_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fovW = fovH * camera.aspect;
    const narrow = camera.aspect < 0.78;
    const focusFit = Math.min((fovH * (narrow ? 0.52 : FOCUS_FILL)) / TAG_H, (fovW * 0.84) / TAG_W);
    camera.getWorldDirection(dir);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    focusWorld.copy(dir).multiplyScalar(FOCUS_DIST).add(camera.position);
    focusLocal.copy(focusWorld);
    this.parent.worldToLocal(focusLocal);

    // Smooth 3D cursor parallax tilt on the focused bookmark
    this.tilt.x = damp(this.tilt.x, this.focused ? -this.pointerNDC.y * 0.11 : 0, 5.5, dt);
    this.tilt.y = damp(this.tilt.y, this.focused ? this.pointerNDC.x * 0.14 : 0, 5.5, dt);
    const breatheX = Math.sin(time * 1.4) * 0.025;
    const breatheY = Math.cos(time * 1.05) * 0.035;
    tiltQ.setFromEuler(new THREE.Euler(this.tilt.x + breatheX, this.tilt.y + breatheY, Math.sin(time * 0.9) * 0.012, 'YXZ'));
    focusQ.copy(parentInvQ).multiply(camera.quaternion).multiply(tiltQ);

    // Subtle lateral/upward arc offset in parent space while peeling off / returning to branch
    arcVec.copy(up).multiplyScalar(0.85).addScaledVector(right, 0.55).applyQuaternion(parentInvQ);

    this.tags.forEach((tag, i) => {
      const isFocused = i === this.focusIndex;
      // Silky critically-damped glide (faster peel-off, gentle float-back)
      tag.focus = damp(tag.focus, isFocused ? 1 : 0, isFocused ? 5.2 : 4.2, dt);
      const t = blendPosition(v, tag.tree, tag.scatter, tag.seed, progress, time);

      // Multi-harmonic organic winter breeze around the top eyelet pivot
      const ph = tag.swayPhase + i * 1.37;
      const breeze = (Math.sin(time * 1.15 + ph) * 0.62 + Math.sin(time * 2.15 + ph * 1.6) * 0.28 + Math.sin(time * 0.45 + ph * 0.5) * 0.35);
      const settleAge = time - tag.landedAt;
      const settleSwing = (settleAge >= 0 && settleAge < 3.0)
        ? Math.exp(-settleAge * 1.8) * Math.sin(settleAge * 6.0) * 0.24
        : 0;

      // Lantern-like curved birth entrance when newly submitted
      let birthScale = 1;
      let birthGlow = 0;
      let birthSwing = 0;
      const birthAge = time - tag.birthStart;
      if (birthAge >= 0 && birthAge < 4.5) {
        const flight = Math.min(1, birthAge / 1.45);
        // Smooth easeOutQuint
        const ease = 1 - Math.pow(1 - flight, 5);
        const startR = TREE.radius + 4.5;
        const spiralA = tag.treeYaw - (1 - ease) * 1.35;
        birthPos.set(Math.cos(spiralA) * startR, TREE.baseY - 1.2, Math.sin(spiralA) * startR);
        v.lerpVectors(birthPos, v, ease);
        // Graceful upward bow during ascent
        v.y += Math.sin(flight * Math.PI) * 1.4;
        birthScale = 0.25 + 0.75 * ease;
        birthGlow = Math.exp(-birthAge * 0.75) * 0.65;
        if (birthAge > 0.95) {
          if (!tag.birthSparked) {
            tag.birthSparked = true;
            this.emitSparks(v);
          }
          const s = birthAge - 0.95;
          birthSwing = Math.exp(-s * 1.7) * Math.sin(s * 5.8) * 0.36;
        }
      }

      // Base orientation: hang outward on tree, drift gently facing viewer when scattered
      q.setFromEuler(new THREE.Euler(0, tag.treeYaw, 0, 'YXZ'));
      if (t < 1) {
        q3.copy(focusQ).multiply(new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.sin(time * 0.6 + i) * 0.14, Math.sin(time * 0.5 + i) * 0.35, Math.cos(time * 0.7 + i) * 0.12),
        ));
        q.slerp(q3, 1 - t);
      }

      let sc = tag.scale * (1 + (1 - t) * 0.32) * birthScale;
      const f = tag.focus;
      const easeF = f * f * (3 - 2 * f);

      if (f > 0.001) {
        v.lerp(focusLocal, easeF);
        // Curved arc peel-off + gentle float bob while inspecting
        const arc = Math.sin(easeF * Math.PI);
        v.addScaledVector(arcVec, arc * 1.15);
        v.y += Math.sin(time * 1.8) * 0.035 * easeF;
        q.slerp(focusQ, easeF);
        // Slight graceful bank during mid-flight
        if (arc > 0.01) {
          q.multiply(q3.setFromEuler(new THREE.Euler(arc * 0.18, -arc * 0.32, arc * 0.1)));
        }
        sc = THREE.MathUtils.lerp(sc, focusFit, easeF);
      }

      // Eye-pivot pendulum swing attenuates cleanly to 0 as bookmark focuses
      const hangAmt = t * (1 - easeF);
      const swingZ = (breeze * 0.095 + settleSwing + birthSwing) * hangAmt;
      const swingX = (Math.cos(time * 0.95 + ph) * 0.055 + birthSwing * 0.3) * hangAmt;
      tag.swing.rotation.set(swingX, breeze * 0.07 * hangAmt, swingZ);
      // Shift visual center onto root position while focused so it frames dead-center in viewport
      tag.swing.position.y = EYELET_PIVOT * easeF;

      // Secondary delayed pendulum for the bottom gold tassel
      const tasselLag = Math.sin(time * 1.15 + ph - 0.65) * 0.16 * hangAmt - swingZ * 0.55;
      tag.tasselPivot.rotation.set(-swingX * 0.6, 0, tasselLag + Math.sin(time * 1.6 + i) * 0.03 * easeF);

      tag.mesh.position.copy(v);
      tag.mesh.quaternion.copy(q);
      tag.mesh.scale.setScalar(sc);
      tag.cord.visible = t > 0.55 && f < 0.15;
      tag.haloMat.opacity = Math.min(0.85, (0.12 + 0.06 * Math.sin(time * 1.6 + i)) * (1 - easeF) + easeF * 0.34 + birthGlow);
      tag.mesh.renderOrder = f > 0.05 ? 25 : 0;
    });

    this.updateSparks(dt);
  }

  updateSparks(dt) {
    const posAttr = this.sparkGeo.attributes.position;
    const alphaAttr = this.sparkGeo.attributes.aAlpha;
    const sizeAttr = this.sparkGeo.attributes.aSize;
    let active = false;
    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i];
      if (sp.age < sp.life) {
        active = true;
        sp.age += dt;
        const u = Math.min(1, sp.age / sp.life);
        sp.vel.multiplyScalar(Math.exp(-1.6 * dt));
        sp.vel.y += 0.35 * dt;
        sp.pos.addScaledVector(sp.vel, dt);
        posAttr.setXYZ(i, sp.pos.x, sp.pos.y, sp.pos.z);
        alphaAttr.setX(i, Math.sin(u * Math.PI) * (1 - u * 0.4));
        sizeAttr.setX(i, sp.size * (1 - u * 0.45));
      } else {
        alphaAttr.setX(i, 0);
      }
    }
    this.sparkPts.visible = active;
    if (active) {
      posAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    }
  }
}
