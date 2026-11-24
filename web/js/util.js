// Shared constants + small helpers (textures, easing) used by the scene modules.
import * as THREE from 'three';

export const TREE = { height: 12, radius: 4.8, baseY: -5.4, tiers: 7 };
export const GROUND_Y = TREE.baseY - 0.35;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

/** Tree silhouette radius at normalized height h (0 bottom .. 1 top), with layered tiers. */
export function treeRadiusAt(h) {
  const tierT = (h * TREE.tiers) % 1;
  const tierShape = 0.74 + 0.34 * Math.pow(1 - tierT, 1.4);
  return TREE.radius * (1 - h) * tierShape;
}

/** Deterministic PRNG so the tree looks the same on every load. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Random point in the "scattered galaxy" cloud around the tree. */
export function scatterPoint(rand, out = new THREE.Vector3(), minR = 6, maxR = 19) {
  const u = rand() * 2 - 1;
  const th = rand() * Math.PI * 2;
  const r = minR + (maxR - minR) * Math.pow(rand(), 0.7);
  const s = Math.sqrt(1 - u * u);
  return out.set(r * s * Math.cos(th), r * u * 0.62 + 1.2, r * s * Math.sin(th));
}

/**
 * Per-item tree<->scatter blend, mirrored in the particle vertex shader so meshes
 * and particles move together. progress: 0 scattered .. 1 tree.
 */
export function blendFactor(seed, progress) {
  const delay = seed * 0.4;
  return smoothstep(delay, delay + 0.6, progress);
}

export function blendPosition(out, tree, scatter, seed, progress, time) {
  const t = blendFactor(seed, progress);
  out.lerpVectors(scatter, tree, t);
  const swirl = (1 - t) * (1.0 + seed * 2.0) * 1.2 + time * 0.04 * (1 - t);
  const c = Math.cos(swirl), s = Math.sin(swirl);
  const x = out.x * c - out.z * s, z = out.x * s + out.z * c;
  const f = (1 - t) * 0.35;
  out.set(
    x + f * Math.sin(time * 0.7 + seed * 31),
    out.y + f * Math.sin(time * 0.9 + seed * 17),
    z + f * Math.cos(time * 0.6 + seed * 23),
  );
  return t;
}

// GLSL version of blendPosition (keep in sync with the JS above).
export const BLEND_GLSL = /* glsl */`
  vec3 blendPos(vec3 treeP, vec3 scatterP, float seed, float progress, float time, out float t) {
    float delay = seed * 0.4;
    t = smoothstep(delay, delay + 0.6, progress);
    vec3 p = mix(scatterP, treeP, t);
    float swirl = (1.0 - t) * (1.0 + seed * 2.0) * 1.2 + time * 0.04 * (1.0 - t);
    float c = cos(swirl), s = sin(swirl);
    p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    float f = (1.0 - t) * 0.35;
    p += f * vec3(sin(time * 0.7 + seed * 31.0), sin(time * 0.9 + seed * 17.0), cos(time * 0.6 + seed * 23.0));
    return p;
  }
`;

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGlowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,170,60,0)') {
  return canvasTexture(256, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.18, inner.replace(/[\d.]+\)$/, '0.48)'));
    grd.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.12)'));
    grd.addColorStop(1, outer);
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  });
}

export function makeFlakeTexture() {
  return canvasTexture(128, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c * 0.82);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.32, 'rgba(235,245,255,0.45)');
    grd.addColorStop(0.7, 'rgba(220,235,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.translate(c, c);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, -c * 0.62);
      g.moveTo(0, -c * 0.34); g.lineTo(-c * 0.14, -c * 0.48);
      g.moveTo(0, -c * 0.34); g.lineTo(c * 0.14, -c * 0.48);
      g.stroke();
    }
  });
}
