// Polaroid-style photo cards nestled inside the tree. While scattered, an OK gesture
// (or clicking a floating card) pulls a card cleanly in front of the camera.
import * as THREE from 'three';
import { TREE, treeRadiusAt, rng, scatterPoint, blendPosition, damp, makeGlowTexture } from './util.js';

const CARD_H = 1.25;     // base card height on the tree
const FOCUS_DIST = 5.4;  // distance in front of the camera (clear of scattered ornaments)
const FOCUS_FILL_H = 0.62;
const FOCUS_FILL_W = 0.86;

const PLACEHOLDERS = [
  ['Merry Christmas', '圣诞快乐 · 平安喜乐', ['#5e0b15', '#a41623']],
  ['Happy New Year', '星光常伴 · 新岁安康', ['#0b3b24', '#166f42']],
  ['Let It Snow', '愿冬日所有美好如约而至', ['#0c1b3a', '#264482']],
  ['Warm Wishes', '温暖常在 · 万事胜意', ['#4a2e08', '#9e6c1c']],
  ['Starry Night', '银河璀璨 · 共赴佳节', ['#350d30', '#7c2463']],
  ['Your Memory', '点右上角「照片管理」上传照片', ['#0c3240', '#1d6c80']],
];

function placeholderTexture([en, zh, [c1, c2]]) {
  const c = document.createElement('canvas');
  c.width = 560; c.height = 700;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 560, 700);
  grd.addColorStop(0, c1); grd.addColorStop(1, c2);
  g.fillStyle = grd; g.fillRect(0, 0, 560, 700);

  // Subtle decorative snow dots
  const rand = rng(en.length * 19);
  for (let i = 0; i < 65; i++) {
    g.fillStyle = `rgba(255,248,230,${0.12 + rand() * 0.35})`;
    g.beginPath(); g.arc(rand() * 560, rand() * 700, 1 + rand() * 3, 0, Math.PI * 2); g.fill();
  }

  // Thin gold foil inner frame
  g.strokeStyle = 'rgba(245,204,116,0.48)';
  g.lineWidth = 3;
  g.strokeRect(24, 24, 512, 652);

  g.textAlign = 'center';
  g.font = '88px serif';
  g.fillText('🎄', 280, 215);

  g.fillStyle = '#f8d78c';
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 10;
  g.font = 'italic 58px "Brush Script MT","Segoe Script",Georgia,serif';
  g.fillText(en, 280, 340);

  g.shadowBlur = 6;
  g.font = '32px "PingFang SC","Microsoft YaHei",sans-serif';
  g.fillStyle = '#f5ede0';
  g.fillText(zh, 280, 425);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: 560 / 700 };
}

export class PhotoGallery {
  constructor(parent, { maxAnisotropy = 4 } = {}) {
    this.parent = parent;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.cards = [];
    this.loader = new THREE.TextureLoader();
    this.maxAnisotropy = maxAnisotropy;
    this.focusIndex = -1;
    this.lastShown = -1;
    this.frameGeo = new THREE.PlaneGeometry(1, 1);
    this.haloTex = makeGlowTexture('rgba(255,214,130,0.65)', 'rgba(255,150,40,0)');
    this.tmp = {
      v: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
      q3: new THREE.Quaternion(), dir: new THREE.Vector3(), focusWorld: new THREE.Vector3(),
      focusLocal: new THREE.Vector3(), focusQ: new THREE.Quaternion(),
    };
  }

  get count() { return this.cards.length; }
  get focused() { return this.focusIndex >= 0; }
  get usingPlaceholders() { return this.cards.length > 0 && this.cards.every((c) => c.placeholder); }

  async setPhotos(list) {
    const wanted = list.length ? list.map((p) => ({ ...p, placeholder: false }))
      : PLACEHOLDERS.map((p, i) => ({ id: `ph-${i}`, placeholder: true, data: p }));
    const keep = new Set(wanted.map((p) => p.id));
    for (const c of [...this.cards]) if (!keep.has(c.id)) this.removeCard(c);
    const have = new Set(this.cards.map((c) => c.id));
    for (const p of wanted) if (!have.has(p.id)) this.addCard(p);
    const order = new Map(wanted.map((p, i) => [p.id, i]));
    this.cards.sort((a, b) => order.get(a.id) - order.get(b.id));
    this.layout();
    if (this.focusIndex >= this.cards.length) this.focusIndex = -1;
  }

  addCard(p) {
    // Crisp warm ivory Polaroid paper (toneMapped: true keeps white crisp without triggering bloom)
    const frameMat = new THREE.MeshBasicMaterial({ color: '#f3ece0', side: THREE.DoubleSide });
    const trimMat = new THREE.MeshBasicMaterial({ color: '#d4a348', side: THREE.DoubleSide });
    const photoMat = new THREE.MeshBasicMaterial({ color: '#202020', side: THREE.DoubleSide });
    const haloMat = new THREE.SpriteMaterial({
      map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });

    const mesh = new THREE.Group();
    const frame = new THREE.Mesh(this.frameGeo, frameMat);
    const trim = new THREE.Mesh(this.frameGeo, trimMat);
    trim.position.z = 0.005;
    const photo = new THREE.Mesh(this.frameGeo, photoMat);
    photo.position.z = 0.012;
    const halo = new THREE.Sprite(haloMat);
    halo.position.z = -0.06;

    const string = new THREE.Mesh(
      new THREE.PlaneGeometry(0.018, 0.48),
      new THREE.MeshBasicMaterial({ color: '#e8bc62', side: THREE.DoubleSide }),
    );
    mesh.add(halo, frame, trim, photo, string);

    const card = {
      id: p.id, placeholder: p.placeholder, mesh, frame, trim, photo, halo, string,
      frameMat, trimMat, photoMat, haloMat, focus: 0, aspect: 0.8,
    };
    frame.userData.card = card;
    photo.userData.card = card;

    this.setAspect(card, p.placeholder ? 0.8 : (p.w / p.h || 0.8));
    if (p.placeholder) {
      const { tex } = placeholderTexture(p.data);
      photoMat.map = tex; photoMat.color.set('#ffffff'); photoMat.needsUpdate = true;
    } else {
      this.loader.load(p.url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.maxAnisotropy;
        photoMat.map = tex; photoMat.color.set('#ffffff'); photoMat.needsUpdate = true;
      });
    }
    this.group.add(mesh);
    this.cards.push(card);
  }

  setAspect(card, aspect) {
    card.aspect = Math.min(2.2, Math.max(0.45, aspect));
    // Keep wide landscape cards visually balanced on the tree without cropping or squishing
    const ph = card.aspect > 1.2 ? (CARD_H * 0.78) / Math.pow(card.aspect / 1.15, 0.35) : CARD_H * 0.78;
    const pw = ph * card.aspect;
    const pad = 0.068;
    const fh = ph + pad * 2 + 0.16;
    const fw = pw + pad * 2;
    card.photo.scale.set(pw, ph, 1);
    card.photo.position.y = 0.055;
    card.trim.scale.set(pw + 0.022, ph + 0.022, 1);
    card.trim.position.y = 0.055;
    card.frame.scale.set(fw, fh, 1);
    card.halo.scale.set(fw * 1.9, fh * 1.8, 1);
    card.string.position.y = fh / 2 + 0.24;
    card.width = fw;
    card.height = fh;
  }

  removeCard(card) {
    this.group.remove(card.mesh);
    card.photoMat.map?.dispose();
    card.photoMat.dispose();
    card.frameMat.dispose();
    card.trimMat.dispose();
    card.haloMat.dispose();
    card.string.geometry.dispose();
    card.string.material.dispose();
    this.cards.splice(this.cards.indexOf(card), 1);
  }

  layout() {
    const n = this.cards.length;
    const rand = rng(42);
    this.cards.forEach((c, i) => {
      const h = 0.14 + (n > 1 ? i / (n - 1) : 0.5) * 0.62;
      const a = i * 2.39996 + 0.6;
      const r = treeRadiusAt(h) + 0.38;
      c.tree = new THREE.Vector3(Math.cos(a) * r, TREE.baseY + h * TREE.height, Math.sin(a) * r);
      c.treeYaw = Math.atan2(c.tree.x, c.tree.z);
      c.scatter = scatterPoint(rand, new THREE.Vector3(), 6.8, 11.5);
      c.seed = 0.15 + rand() * 0.5;
      c.scale = n > 24 ? 0.78 : 1;
    });
  }

  showNext() {
    if (!this.cards.length) return -1;
    this.lastShown = (this.lastShown + 1) % this.cards.length;
    this.focusIndex = this.lastShown;
    return this.focusIndex;
  }

  showAt(index) {
    if (index < 0 || index >= this.cards.length) return -1;
    this.lastShown = index;
    this.focusIndex = index;
    return index;
  }

  pickCard(raycaster) {
    const targets = [];
    for (const c of this.cards) targets.push(c.photo, c.frame);
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return -1;
    return this.cards.indexOf(hits[0].object.userData.card);
  }

  hide() { this.focusIndex = -1; }

  update(time, progress, dt, camera) {
    const { v, q, q2, q3, dir, focusWorld, focusLocal, focusQ } = this.tmp;
    const parentInvQ = this.parent.getWorldQuaternion(q2).invert();
    const fovH = 2 * FOCUS_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fovW = fovH * camera.aspect;
    const narrow = camera.aspect < 0.78;
    const maxH = fovH * (narrow ? 0.54 : FOCUS_FILL_H);
    const maxW = fovW * (narrow ? 0.88 : FOCUS_FILL_W);
    camera.getWorldDirection(dir);
    focusWorld.copy(dir).multiplyScalar(FOCUS_DIST).add(camera.position);
    focusLocal.copy(focusWorld);
    this.parent.worldToLocal(focusLocal);
    focusQ.copy(parentInvQ).multiply(camera.quaternion);

    this.cards.forEach((c, i) => {
      c.focus = damp(c.focus, i === this.focusIndex ? 1 : 0, 6.5, dt);
      const t = blendPosition(v, c.tree, c.scatter, c.seed, progress, time);
      const sway = Math.sin(time * 1.3 + i) * 0.08 * t;
      q.setFromEuler(new THREE.Euler(sway * 0.5, c.treeYaw + sway, sway, 'YXZ'));
      if (t < 1) {
        q3.copy(focusQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.sin(time * 0.5 + i) * 0.45, 0)));
        q.slerp(q3, 1 - t);
      }
      let s = c.scale * (1 + (1 - t) * 0.52);
      if (c.focus > 0.001) {
        const e = c.focus * c.focus * (3 - 2 * c.focus);
        v.lerp(focusLocal, e);
        q.slerp(focusQ, e);
        const fitScale = Math.min(maxH / c.height, maxW / c.width);
        s = THREE.MathUtils.lerp(s, fitScale, e);
      }
      c.mesh.position.copy(v);
      c.mesh.quaternion.copy(q);
      c.mesh.scale.setScalar(s);
      c.string.visible = c.focus < 0.25 && t > 0.55;
      c.haloMat.opacity = c.focus * 0.42;
      c.mesh.renderOrder = c.focus > 0.05 ? 20 : 0;
    });
  }
}
