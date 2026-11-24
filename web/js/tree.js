// The particle Christmas tree: sculpted pine-tier glowing foliage particles, dual spiral
// light ribbons, ambient golden fairy embers, metallic baubles, gift boxes, and faceted star topper.
// Everything blends smoothly between the formed tree (progress = 1) and a scattered galaxy (progress = 0).
import * as THREE from 'three';
import {
  TREE, GROUND_Y, treeRadiusAt, rng, scatterPoint, blendPosition, BLEND_GLSL, makeGlowTexture,
} from './util.js';

const PARTICLE_VERT = /* glsl */`
  uniform float uTime, uProgress, uSize, uPixelRatio, uDim;
  attribute vec3 aScatter, aColor;
  attribute float aSize, aSeed, aWave;
  varying vec3 vColor;
  varying float vAlpha;
  ${BLEND_GLSL}
  void main() {
    float t;
    vec3 p = blendPos(position, aScatter, aSeed, uProgress, uTime, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float tw = 0.55 + 0.45 * sin(uTime * (1.4 + aSeed * 3.2) + aSeed * 62.8);
    float sparkle = pow(max(0.0, sin(uTime * (2.2 + aSeed * 4.0) + aSeed * 91.0)), 14.0);
    float wave = pow(0.5 + 0.5 * sin(aWave * 42.0 - uTime * 2.4), 7.0);
    float isGarland = step(0.001, aWave);

    // Keep foliage rich and saturated while allowing garland crests and sparkles to pop into bloom
    float foliageGlow = (0.34 + 0.30 * tw + 0.95 * sparkle) * mix(1.45, 0.85, t);
    float garlandGlow = (0.48 + wave * 1.65) * mix(1.15, 1.0, t);
    float glow = mix(foliageGlow, garlandGlow, isGarland);

    vColor = aColor * glow * uDim;
    vAlpha = mix(0.88, 0.96, isGarland);

    float dist = max(-mv.z, 2.2);
    float sz = aSize * uSize * uPixelRatio * (0.78 + 0.28 * tw + 0.35 * sparkle) / dist;
    gl_PointSize = clamp(sz, 1.4, 24.0);
  }
`;

const PARTICLE_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.0, 0.5, d);
    float core = exp(-d * d * 26.0);
    float halo = pow(soft, 2.4) * 0.36;
    gl_FragColor = vec4(vColor * (halo + core * 0.95), soft * vAlpha);
  }
`;

const EMBER_VERT = /* glsl */`
  uniform float uTime, uPixelRatio, uDim;
  attribute float aSeed, aRadius, aHeight, aSpeed;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float y = mod(aHeight + uTime * aSpeed, 15.5) - 5.8;
    float ang = aSeed * 6.2831 + uTime * (0.14 + aSeed * 0.22);
    float r = aRadius * (1.0 - max(0.0, (y + 5.5) / 18.0) * 0.35) + sin(uTime * 0.8 + aSeed * 20.0) * 0.45;
    vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = smoothstep(-5.8, -3.5, y) * (1.0 - smoothstep(6.5, 9.7, y));
    float tw = 0.45 + 0.55 * sin(uTime * (2.5 + aSeed * 3.0) + aSeed * 50.0);
    vAlpha = life * tw * 0.85 * uDim;
    vColor = mix(vec3(1.0, 0.78, 0.32), vec3(1.0, 0.94, 0.72), aSeed);
    gl_PointSize = clamp((18.0 + aSeed * 22.0) * uPixelRatio / max(-mv.z, 2.5), 1.5, 14.0);
  }
`;

const EMBER_FRAG = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float g = exp(-d * d * 22.0);
    gl_FragColor = vec4(vColor * g * 1.1, g * vAlpha);
  }
`;

const FOLIAGE_PALETTE = [
  ['#095c30', 0.30, 1.00], // deep emerald pine
  ['#138d4a', 0.22, 0.95], // luminous spruce green
  ['#22b563', 0.08, 0.85], // fresh pine highlights
  ['#f4be4c', 0.20, 1.05], // champagne gold
  ['#fff0c2', 0.08, 0.88], // warm starlight ivory
  ['#e63946', 0.08, 1.10], // Christmas ruby
  ['#ff9966', 0.04, 0.95], // warm amber rose
];

function pickPalette(rand) {
  let r = rand();
  for (const p of FOLIAGE_PALETTE) { if ((r -= p[1]) <= 0) return p; }
  return FOLIAGE_PALETTE[0];
}

export class ChristmasTree {
  constructor({ quality = 1, envMap }) {
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 }, uProgress: { value: 1 }, uSize: { value: 52 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, uDim: { value: 1 },
    };
    this.items = [];
    this.buildFoliage(Math.round(22000 * quality));
    this.buildGarland(Math.round(2200 * quality));
    this.buildEmbers(Math.round(520 * quality));
    this.buildOrnaments(envMap);
    this.buildStar();
    this.buildTrunk();
  }

  makePoints(tree, scatter, colors, sizes, seeds, waves) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tree, 3));
    g.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatter, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute('aWave', new THREE.Float32BufferAttribute(waves, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 32);
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    this.group.add(pts);
    return pts;
  }

  buildFoliage(n) {
    const rand = rng(7);
    const tree = new Float32Array(n * 3), scatter = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n), seeds = new Float32Array(n), waves = new Float32Array(n);
    const v = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const h = 1 - Math.sqrt(rand());
      const maxR = treeRadiusAt(h);
      // Shell-biased distribution so branch tiers read clearly without blowing out the core
      const shellBias = rand() < 0.72 ? (0.62 + 0.38 * Math.pow(rand(), 0.5)) : (0.18 + 0.55 * rand());
      const a = rand() * Math.PI * 2;
      // Scalloped pine-branch lobes around each tier
      const lobe = 0.88 + 0.14 * Math.sin(a * (6 + Math.floor((1 - h) * 5)) + h * 14);
      const r = maxR * shellBias * lobe;
      const droop = -0.22 * shellBias * (1 - h);
      tree.set([
        Math.cos(a) * r,
        TREE.baseY + h * TREE.height + droop + (rand() - 0.5) * 0.2,
        Math.sin(a) * r,
      ], i * 3);
      scatterPoint(rand, v, 6.5, 19);
      scatter.set([v.x, v.y, v.z], i * 3);

      const [hex, , sm] = pickPalette(rand);
      col.set(hex).convertSRGBToLinear();
      // Gently attenuate inner particles so outer needles & lights stay rich
      const shade = 0.55 + 0.55 * shellBias;
      colors.set([col.r * shade, col.g * shade, col.b * shade], i * 3);
      sizes[i] = (0.36 + rand() * 0.68) * sm;
      seeds[i] = rand();
    }
    this.foliage = this.makePoints(tree, scatter, colors, sizes, seeds, waves);
  }

  buildGarland(n) {
    const rand = rng(11);
    const tree = new Float32Array(n * 3), scatter = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n), seeds = new Float32Array(n), waves = new Float32Array(n);
    const v = new THREE.Vector3(), col = new THREE.Color();
    const gold = new THREE.Color('#ffd37a').convertSRGBToLinear();
    const warmWhite = new THREE.Color('#fff4d8').convertSRGBToLinear();
    const roseGold = new THREE.Color('#ffaa78').convertSRGBToLinear();

    const half = Math.floor(n * 0.65);
    for (let i = 0; i < n; i++) {
      const primary = i < half;
      const u = primary ? (i / half) : ((i - half) / (n - half));
      const h = 0.03 + u * 0.92;
      const turns = primary ? 6.5 : -4.5;
      const a = u * turns * Math.PI * 2 + (primary ? 0 : Math.PI);
      const r = treeRadiusAt(h) * (primary ? 1.03 : 0.98) + 0.08;
      const spread = primary ? 0.09 : 0.14;
      tree.set([
        Math.cos(a) * r + (rand() - 0.5) * spread,
        TREE.baseY + h * TREE.height + (rand() - 0.5) * spread,
        Math.sin(a) * r + (rand() - 0.5) * spread,
      ], i * 3);
      scatterPoint(rand, v, 5.5, 16);
      scatter.set([v.x, v.y, v.z], i * 3);
      col.copy(primary ? (rand() < 0.65 ? gold : warmWhite) : roseGold);
      const mult = primary ? 1.05 : 0.82;
      colors.set([col.r * mult, col.g * mult, col.b * mult], i * 3);
      sizes[i] = (primary ? 0.52 : 0.42) + rand() * 0.34;
      seeds[i] = rand();
      waves[i] = u + 0.001;
    }
    this.garland = this.makePoints(tree, scatter, colors, sizes, seeds, waves);
  }

  buildEmbers(n) {
    const rand = rng(53);
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const radius = new Float32Array(n), height = new Float32Array(n), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = rand();
      radius[i] = 2.6 + rand() * 5.8;
      height[i] = rand() * 15.5;
      speed[i] = 0.35 + rand() * 0.65;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aRadius', new THREE.Float32BufferAttribute(radius, 1));
    g.setAttribute('aHeight', new THREE.Float32BufferAttribute(height, 1));
    g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 20);
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.embers = new THREE.Points(g, m);
    this.group.add(this.embers);
  }

  addInstances(mesh, count, place, rand) {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const { tree, scale } = place(i, rand);
      const scatter = scatterPoint(rand, new THREE.Vector3(), 6.8, 17);
      e.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      this.items.push({ mesh, index: i, tree, scatter, seed: rand(), scale, rot: q.setFromEuler(e).clone(), spin: (rand() - 0.5) * 1.8 });
    }
    this.group.add(mesh);
  }

  buildOrnaments(envMap) {
    const rand = rng(23);
    const col = new THREE.Color();

    // Jewel-toned metallic baubles
    const ballCount = 155;
    const ballMat = new THREE.MeshStandardMaterial({ metalness: 0.92, roughness: 0.16, envMap, envMapIntensity: 1.05 });
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 24, 16), ballMat, ballCount);
    const ballColors = ['#f4be4c', '#e6a832', '#c81d25', '#a61420', '#168544', '#f2e8d5', '#d97777'];
    this.addInstances(balls, ballCount, (i, r) => {
      const h = 0.05 + Math.pow(r(), 0.85) * 0.86;
      const a = i * 2.39996 + r() * 0.45;
      const rad = treeRadiusAt(h) * (0.90 + r() * 0.12);
      balls.setColorAt(i, col.set(ballColors[Math.floor(r() * ballColors.length)]));
      return { tree: new THREE.Vector3(Math.cos(a) * rad, TREE.baseY + h * TREE.height, Math.sin(a) * rad), scale: 0.65 + r() * 0.72 };
    }, rand);
    this.balls = balls;

    // Warm incandescent fairy light bulbs perched along branch tips
    const bulbCount = 90;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: '#fff2cc', emissive: '#ffbb44', emissiveIntensity: 1.35, roughness: 0.25, metalness: 0.1,
    });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.065, 12, 10), bulbMat, bulbCount);
    const bulbColors = ['#ffd57a', '#fff1cc', '#ff8c66', '#ffd57a'];
    this.addInstances(bulbs, bulbCount, (i, r) => {
      const h = 0.06 + r() * 0.86;
      const a = i * 2.39996 + 1.2 + r() * 0.4;
      const rad = treeRadiusAt(h) * (0.98 + r() * 0.06);
      bulbs.setColorAt(i, col.set(bulbColors[i % bulbColors.length]));
      return { tree: new THREE.Vector3(Math.cos(a) * rad, TREE.baseY + h * TREE.height, Math.sin(a) * rad), scale: 0.8 + r() * 0.55 };
    }, rand);
    this.bulbs = bulbs;
    this.bulbMat = bulbMat;

    // Gift boxes around the base + miniature gift ornaments in branches
    const giftCount = 32;
    const giftMat = new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.44, envMap, envMapIntensity: 0.75 });
    const gifts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), giftMat, giftCount);
    const giftColors = ['#b81d2a', '#146b3a', '#d49a2a', '#1e3a6d', '#8e1b3a', '#246a5c'];
    this.addInstances(gifts, giftCount, (i, r) => {
      gifts.setColorAt(i, col.set(giftColors[i % giftColors.length]));
      if (i < 16) {
        const a = (i / 16) * Math.PI * 2 + r() * 0.28;
        const rad = TREE.radius * (0.50 + r() * 0.48);
        const s = 1.0 + r() * 0.9;
        return { tree: new THREE.Vector3(Math.cos(a) * rad, GROUND_Y + 0.25 * s, Math.sin(a) * rad), scale: s };
      }
      const h = 0.1 + r() * 0.65;
      const a = r() * Math.PI * 2;
      const rad = treeRadiusAt(h) * 0.84;
      return { tree: new THREE.Vector3(Math.cos(a) * rad, TREE.baseY + h * TREE.height, Math.sin(a) * rad), scale: 0.48 + r() * 0.34 };
    }, rand);
    this.gifts = gifts;

    const ribbonMat = new THREE.MeshStandardMaterial({
      color: '#f2c15a', metalness: 0.9, roughness: 0.24, envMap, envMapIntensity: 1.0,
      emissive: '#3b2400', emissiveIntensity: 0.25,
    });
    this.ribbonsA = new THREE.InstancedMesh(new THREE.BoxGeometry(0.515, 0.515, 0.11), ribbonMat, giftCount);
    this.ribbonsB = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.515, 0.515), ribbonMat, giftCount);
    this.group.add(this.ribbonsA, this.ribbonsB);
  }

  buildStar() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.72 : 0.30;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      i === 0 ? shape.moveTo(Math.cos(a) * r, Math.sin(a) * r) : shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 3 });
    geo.center();
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffe082', emissive: '#ffaa22', emissiveIntensity: 1.4, metalness: 0.75, roughness: 0.2,
    });
    this.star = new THREE.Mesh(geo, mat);
    this.starTreePos = new THREE.Vector3(0, TREE.baseY + TREE.height + 0.55, 0);
    this.starScatterPos = new THREE.Vector3(0, TREE.baseY + TREE.height + 2.8, 0);
    this.star.position.copy(this.starTreePos);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,230,155,0.85)', 'rgba(255,140,30,0)'),
      color: '#ffd27a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.68,
    }));
    halo.scale.setScalar(3.6);
    this.star.add(halo);
    this.starHalo = halo;

    const rayTex = makeGlowTexture('rgba(255,248,220,0.9)', 'rgba(255,195,90,0)');
    this.rays = [];
    for (let i = 0; i < 2; i++) {
      const ray = new THREE.Sprite(new THREE.SpriteMaterial({
        map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.52,
      }));
      ray.scale.set(i ? 0.22 : 5.2, i ? 4.2 : 0.22, 1);
      this.star.add(ray);
      this.rays.push(ray);
    }

    this.starLight = new THREE.PointLight('#ffcc6e', 14, 15, 1.8);
    this.star.add(this.starLight);
    this.group.add(this.star);
  }

  buildTrunk() {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.52, 1.25, 16),
      new THREE.MeshStandardMaterial({ color: '#3b2110', roughness: 0.92 }),
    );
    trunk.position.y = GROUND_Y + 0.62;
    this.trunk = trunk;
    this.group.add(trunk);

    this.innerLights = ['#ffb84d', '#ff595e', '#ffd478'].map((c, i) => {
      const l = new THREE.PointLight(c, 8, 9, 2.0);
      l.position.set(Math.cos(i * 2.1) * 1.4, TREE.baseY + 2 + i * 2.7, Math.sin(i * 2.1) * 1.4);
      this.group.add(l);
      return l;
    });
  }

  update(time, progress, dim = 1) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uProgress.value = progress;
    u.uDim.value = dim;

    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const q = new THREE.Quaternion(), spinQ = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let giftIdx = 0;
    for (const it of this.items) {
      const t = blendPosition(p, it.tree, it.scatter, it.seed, progress, time);
      spinQ.setFromAxisAngle(up, time * 0.28 * it.spin);
      q.copy(it.rot).slerp(spinQ, t);
      const sc = it.scale * (1 + (1 - t) * 0.18);
      s.setScalar(sc);
      m.compose(p, q, s);
      it.mesh.setMatrixAt(it.index, m);
      if (it.mesh === this.gifts) {
        this.ribbonsA.setMatrixAt(giftIdx, m);
        this.ribbonsB.setMatrixAt(giftIdx, m);
        giftIdx++;
      }
    }
    for (const mesh of [this.balls, this.bulbs, this.gifts, this.ribbonsA, this.ribbonsB]) {
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.bulbMat.emissiveIntensity = (1.1 + 0.35 * Math.sin(time * 2.6)) * dim;

    this.star.position.lerpVectors(this.starScatterPos, this.starTreePos, progress);
    this.star.rotation.y = time * 0.75;
    const pulse = 1 + Math.sin(time * 2.2) * 0.06;
    this.starHalo.scale.setScalar(3.6 * pulse * (0.75 + 0.35 * progress));
    this.starHalo.material.opacity = 0.62 * dim;
    this.rays.forEach((r, i) => {
      r.material.rotation = time * 0.12 + i * Math.PI / 2;
      r.material.opacity = (0.42 + 0.16 * Math.sin(time * 1.8 + i)) * dim;
    });
    this.star.material.emissiveIntensity = (1.25 + Math.sin(time * 3) * 0.2) * dim;
    this.starLight.intensity = 14 * (0.4 + 0.6 * progress) * dim;

    this.trunk.scale.setScalar(Math.max(0.001, (progress - 0.6) / 0.4));
    this.trunk.visible = progress > 0.6;

    this.innerLights.forEach((l, i) => {
      l.intensity = (6.5 + 3.2 * Math.sin(time * (2.8 + i) + i * 2) + 1.5 * Math.sin(time * 9.7 + i)) * (0.25 + 0.75 * progress) * dim;
    });
  }

  setPixelRatio(pr) { this.uniforms.uPixelRatio.value = pr; }
}
