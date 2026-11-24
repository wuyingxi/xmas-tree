// Christmas night atmosphere: deep midnight sky with subtle aurora, twinkling stars,
// warm festive bokeh, seamless rolling snow ground with snow-glints, and multi-layer GPU snowfall.
import * as THREE from 'three';
import { GROUND_Y, rng, makeGlowTexture, makeFlakeTexture } from './util.js';

const SNOW_VERT = /* glsl */`
  uniform float uTime, uHeight, uSize, uPixelRatio, uSpeed;
  attribute float aSeed, aSize;
  varying float vAlpha;
  varying float vRot;
  void main() {
    vec3 p = position;
    float fall = uTime * uSpeed * (0.55 + aSeed * 0.85);
    p.y = mod(p.y - fall, uHeight) - uHeight * 0.5 + 5.0;
    p.x += sin(uTime * (0.35 + aSeed * 0.65) + aSeed * 40.0) * 1.15;
    p.z += cos(uTime * (0.28 + aSeed * 0.55) + aSeed * 25.0) * 0.75;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 2.5);
    gl_PointSize = clamp(aSize * uSize * uPixelRatio / dist, 1.5, 42.0);
    // fade smoothly near top/bottom so flakes never pop
    float yN = clamp((p.y - 5.0) / uHeight + 0.5, 0.0, 1.0);
    float fadeIn = smoothstep(0.0, 0.12, yN);
    float fadeOut = 1.0 - smoothstep(0.84, 1.0, yN);
    vAlpha = fadeIn * fadeOut * (0.42 + aSeed * 0.45);
    vRot = uTime * (aSeed - 0.5) * 1.6 + aSeed * 6.2831;
  }
`;

const SNOW_FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  varying float vRot;
  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float r = length(centered);
    if (r > 0.5) discard;
    float s = sin(vRot), co = cos(vRot);
    vec2 uv = mat2(co, -s, s, co) * centered + 0.5;
    vec4 tex = texture2D(uMap, uv);
    float edgeFade = 1.0 - smoothstep(0.36, 0.5, r);
    gl_FragColor = vec4(vec3(0.90, 0.95, 1.0) * tex.rgb, tex.a * vAlpha * edgeFade);
  }
`;

const TWINKLE_VERT = /* glsl */`
  uniform float uTime, uPixelRatio;
  attribute float aSeed, aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.04 + aSeed * 10.0) * 1.2;
    p.y += cos(uTime * 0.06 + aSeed * 7.0) * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.5 + 0.5 * sin(uTime * (0.65 + aSeed * 1.8) + aSeed * 30.0);
    vColor = aColor * (0.45 + 0.55 * tw);
    gl_PointSize = clamp(aSize * uPixelRatio * 260.0 / max(-mv.z, 4.0), 1.2, 68.0);
  }
`;

const TWINKLE_FRAG = /* glsl */`
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float star = pow(1.0 - smoothstep(0.0, 0.5, d), 3.4);
    float bokehDisc = (1.0 - smoothstep(0.36, 0.5, d)) * 0.42 + (1.0 - smoothstep(0.0, 0.48, d)) * 0.35;
    float a = mix(star, bokehDisc, uSoft);
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const GLINT_VERT = /* glsl */`
  uniform float uTime, uPixelRatio, uProgress;
  attribute float aSeed;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float sparkle = pow(max(0.0, sin(uTime * (1.2 + aSeed * 2.4) + aSeed * 80.0)), 10.0);
    vGlow = sparkle * (0.35 + 0.65 * uProgress);
    gl_PointSize = clamp((2.0 + 3.2 * sparkle) * uPixelRatio * 18.0 / max(-mv.z, 3.0), 1.0, 8.0);
  }
`;

const GLINT_FRAG = /* glsl */`
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = pow(1.0 - smoothstep(0.0, 0.5, d), 2.5) * vGlow;
    gl_FragColor = vec4(vec3(0.85, 0.90, 1.0) * a, a);
  }
`;

export class Environment {
  constructor(scene, { quality = 1 }) {
    this.scene = scene;
    this.pr = Math.min(window.devicePixelRatio, 2);
    this.materials = [];
    this.flakeTex = makeFlakeTexture();
    scene.background = new THREE.Color('#02030a');
    scene.fog = new THREE.FogExp2('#040713', 0.022);
    this.buildSky();
    this.buildStars(Math.round(1800 * quality));
    this.buildBokeh(65);
    this.buildGround(Math.round(900 * quality));
    this.snowFar = this.buildSnow(Math.round(2400 * quality), { spread: 58, depth: [-42, 8], size: 22, speed: 0.9 });
    this.snowMid = this.buildSnow(Math.round(900 * quality), { spread: 34, depth: [-12, 14], size: 34, speed: 1.25 });
    this.snowNear = this.buildSnow(Math.round(280 * quality), { spread: 24, depth: [6, 17], size: 52, speed: 1.55 });
    this.buildLights();
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform float uTime;
        void main(){
          float y = vP.y;
          vec3 top = vec3(0.0005, 0.0010, 0.0045);
          vec3 mid = vec3(0.0025, 0.0055, 0.0170);
          vec3 hor = vec3(0.0140, 0.0070, 0.0120);
          vec3 c = mix(hor, mid, smoothstep(-0.04, 0.24, y));
          c = mix(c, top, smoothstep(0.24, 0.85, y));
          float wave = 0.36 + 0.055 * sin(vP.x * 3.2 + uTime * 0.08) + 0.03 * cos(vP.z * 2.5 - uTime * 0.05);
          float band = exp(-pow((y - wave) * 10.0, 2.0));
          float shimmer = 0.55 + 0.45 * sin(vP.x * 5.0 + uTime * 0.14);
          c += mix(vec3(0.004, 0.024, 0.018), vec3(0.014, 0.008, 0.026), 0.5 + 0.5 * sin(vP.x * 2.0)) * band * shimmer;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
    this.materials.push(mat);
    this.scene.add(this.sky);
  }

  twinklePoints(n, place, soft) {
    const rand = rng(soft ? 99 : 5);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const { p, color, s } = place(rand, c);
      pos.set(p, i * 3); col.set([color.r, color.g, color.b], i * 3); seed[i] = rand(); size[i] = s;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.pr }, uSoft: { value: soft ? 1 : 0 } },
      vertexShader: TWINKLE_VERT, fragmentShader: TWINKLE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.materials.push(mat);
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  buildStars(n) {
    this.twinklePoints(n, (r, c) => {
      const th = r() * Math.PI * 2, y = 0.06 + r() * 0.94, rad = 155;
      const s = Math.sqrt(1 - y * y);
      c.setHSL(0.58 + (r() - 0.5) * 0.45, 0.32, 0.65 + r() * 0.3).convertSRGBToLinear();
      return { p: [Math.cos(th) * s * rad, y * rad * 0.78, Math.sin(th) * s * rad], color: c.clone(), s: 0.75 + r() * 1.45 };
    }, false);
  }

  buildBokeh(n) {
    const palette = ['#ffbe55', '#e84855', '#ffd88a', '#64b5f6', '#2ec4b6', '#ff8fab'];
    this.twinklePoints(n, (r, c) => {
      const th = Math.PI * (0.12 + r() * 0.76) + Math.PI;
      const rad = 36 + r() * 34;
      c.set(palette[Math.floor(r() * palette.length)]).convertSRGBToLinear().multiplyScalar(0.24);
      return { p: [Math.cos(th) * rad, -3.5 + r() * 22, Math.sin(th) * rad], color: c.clone(), s: 2.2 + r() * 4.8 };
    }, true);
  }

  buildGround(glintCount) {
    const geo = new THREE.PlaneGeometry(180, 180, 96, 96);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const d = Math.hypot(x, y);
      const blend = Math.min(1, Math.max(0, (d - 6.5) / 14));
      const smooth = blend * blend * (3 - 2 * blend);
      const drift = Math.sin(x * 0.16) * Math.cos(y * 0.14) * 0.55 + Math.sin(x * 0.07 + y * 0.09) * 0.85;
      pos.setZ(i, drift * smooth);
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#141d34', roughness: 0.82, metalness: 0.06 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.scene.add(ground);

    const rand = rng(31);
    const gPos = new Float32Array(glintCount * 3), gSeed = new Float32Array(glintCount);
    for (let i = 0; i < glintCount; i++) {
      const a = rand() * Math.PI * 2;
      const rad = 2.5 + Math.sqrt(rand()) * 24;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const blend = Math.min(1, Math.max(0, (rad - 6.5) / 14));
      const smooth = blend * blend * (3 - 2 * blend);
      const y = (Math.sin(x * 0.16) * Math.cos(-z * 0.14) * 0.55 + Math.sin(x * 0.07 - z * 0.09) * 0.85) * smooth;
      gPos.set([x, GROUND_Y + y + 0.04, z], i * 3);
      gSeed[i] = rand();
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    gg.setAttribute('aSeed', new THREE.Float32BufferAttribute(gSeed, 1));
    const gMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.pr }, uProgress: { value: 1 } },
      vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.materials.push(gMat);
    this.glintMat = gMat;
    this.scene.add(new THREE.Points(gg, gMat));

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture('rgba(255,195,100,0.85)', 'rgba(255,130,30,0)'),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.42,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = GROUND_Y + 0.03;
    this.groundGlow = glow;
    this.scene.add(glow);
  }

  buildSnow(n, { spread, depth, size, speed }) {
    const rand = rng(size * 7);
    const height = 36;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([(rand() - 0.5) * spread * 2, rand() * height, depth[0] + rand() * (depth[1] - depth[0])], i * 3);
      seed[i] = rand();
      sz[i] = 0.45 + rand() * 0.85;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uHeight: { value: height }, uSize: { value: size }, uPixelRatio: { value: this.pr },
        uSpeed: { value: speed }, uMap: { value: this.flakeTex },
      },
      vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false, fog: false,
    });
    this.materials.push(mat);
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#5c78c8', '#140c06', 0.32));
    const key = new THREE.DirectionalLight('#ffdfb4', 1.05);
    key.position.set(7, 13, 11);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#6b9dff', 0.72);
    rim.position.set(-10, 7, -10);
    this.scene.add(rim);
    const spot = new THREE.SpotLight('#ffebc8', 22, 36, Math.PI / 5, 0.75, 1.5);
    spot.position.set(0, 18, 5);
    spot.target.position.set(0, -1, 0);
    this.scene.add(spot, spot.target);
  }

  update(time, progress) {
    for (const m of this.materials) if (m.uniforms.uTime) m.uniforms.uTime.value = time;
    this.glintMat.uniforms.uProgress.value = progress;
    this.groundGlow.material.opacity = 0.16 + 0.30 * progress + Math.sin(time * 1.4) * 0.025;
  }

  setPixelRatio(pr) {
    for (const m of this.materials) if (m.uniforms.uPixelRatio) m.uniforms.uPixelRatio.value = pr;
  }
}
