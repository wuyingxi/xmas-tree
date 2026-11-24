import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { ChristmasTree } from './tree.js';
import { Environment } from './environment.js';
import { PhotoGallery } from './photos.js?v=9';
import { WishBookmarks } from './wishes.js?v=9';
import { SpaceController, PhotoManager, WishManager } from './ui.js?v=9';
import { HandTracker } from './hands.js?v=8';
import { Gesture } from './gestures.js?v=6';
import { damp } from './util.js';

const $ = (id) => document.getElementById(id);
const isMobile = matchMedia('(max-width: 700px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const quality = isMobile ? 0.55 : 1;

// ---------------------------------------------------------------- renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 500);
const HOME = new THREE.Vector3(0, 0.9, isMobile ? 31 : 24.5);
camera.position.copy(HOME);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 12;
controls.maxDistance = 42;
controls.minPolarAngle = Math.PI * 0.22;
controls.maxPolarAngle = Math.PI * 0.55;
controls.rotateSpeed = 0.6;

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const environment = new Environment(scene, { quality });
const tree = new ChristmasTree({ quality, envMap });
scene.add(tree.group);
const gallery = new PhotoGallery(tree.group, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const wishes = new WishBookmarks(tree.group, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// High threshold so only fairy lights, star topper & bright sparkles get a crisp cinema halo
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.56, 0.48, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- UI helpers
let toastTimer;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- state
const state = {
  target: 1,           // 1 tree, 0 scattered
  progress: 1,
  spinVel: 0.12,
  hand: { present: false, gesture: Gesture.NONE, palm: { x: 0.5, y: 0.5 } },
  prevGesture: Gesture.NONE,
};
let okHideTimer = null;
const SCATTERED = () => state.progress < 0.72 || state.target === 0;

function setTarget(t) {
  state.target = t;
  if (t === 1) hidePhoto();
  updateButtons();
}

function updateCaption(i) {
  const cap = $('caption');
  cap.textContent = gallery.usingPlaceholders
    ? `祝福卡片 ${i + 1} / ${gallery.count}`
    : `珍藏照片 ${i + 1} / ${gallery.count}`;
  cap.classList.add('show');
  updateButtons();
}

function showNextPhoto() {
  if (!SCATTERED()) {
    toast('先张开手掌（或点「散开」）让圣诞树散开，再来看照片 ✋');
    return false;
  }
  unfocusWish();
  const i = gallery.showNext();
  if (i < 0) return false;
  updateCaption(i);
  return true;
}

function hidePhoto() {
  clearTimeout(okHideTimer);
  okHideTimer = null;
  gallery.hide();
  $('caption').classList.remove('show');
  updateButtons();
}

function focusWish(wish) {
  if (!wish) return;
  hidePhoto();
  if (wishes.focusById(wish.id) >= 0) {
    wishManager?.setFocusBarVisible(true);
    updateButtons();
  }
}

function showNextWish() {
  hidePhoto();
  if (wishes.showNext() >= 0) {
    wishManager?.setFocusBarVisible(true);
    updateButtons();
    return true;
  }
  return false;
}

function unfocusWish() {
  if (!wishes.focused) return;
  wishes.unfocus();
  wishManager?.setFocusBarVisible(false);
  updateButtons();
}

function updateButtons() {
  $('btn-toggle').textContent = state.target === 1 ? '✨ 散开' : '🎄 聚合';
  $('btn-photo').textContent = gallery.focused ? '🖼 下一张' : '🖼 看照片';
  $('status-state').textContent = gallery.focused
    ? '正在欣赏照片'
    : wishes.focused
      ? '正在阅读祝福签'
      : state.target === 1
        ? '圣诞树已聚合'
        : '星河散开中';
}

// ---------------------------------------------------------------- fallback & mouse controls
$('btn-toggle').onclick = () => { unfocusWish(); setTarget(state.target === 1 ? 0 : 1); };
$('btn-photo').onclick = () => showNextPhoto();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') { e.preventDefault(); unfocusWish(); setTarget(state.target === 1 ? 0 : 1); }
  if (e.code === 'KeyP') showNextPhoto();
  if (e.code === 'KeyB' || e.code === 'KeyW') showNextWish();
  if (e.code === 'ArrowLeft' && wishes.focused) { wishes.stepFocus(-1); updateButtons(); }
  if (e.code === 'ArrowRight' && wishes.focused) { wishes.stepFocus(1); updateButtons(); }
  if (e.code === 'Escape') { hidePhoto(); unfocusWish(); wishManager.closeModal(); space.closeModal(); }
});
canvas.addEventListener('dblclick', () => {
  if (gallery.focused) hidePhoto();
  else if (wishes.focused) unfocusWish();
  else setTarget(state.target === 1 ? 0 : 1);
});

// Click a 3D bookmark (any time) to fly it forward, or a floating photo card while scattered
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let turnToYaw = null;
let turnUntil = 0;

function setRay(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = -(e.clientY / innerHeight) * 2 + 1;
  wishes.setPointer(nx, ny);
  if (downPos || wishManager?.isModalOpen || space?.isAnyModalOpen) return;
  pointer.set(nx, ny);
  raycaster.setFromCamera(pointer, camera);
  const hit = wishes.pickWish(raycaster) || (SCATTERED() && gallery.pickCard(raycaster) >= 0);
  canvas.style.cursor = hit ? 'pointer' : '';
});
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return;
  setRay(e);
  if (SCATTERED() && !wishes.focused) {
    const idx = gallery.pickCard(raycaster);
    if (idx >= 0) {
      gallery.showAt(idx);
      updateCaption(idx);
      return;
    }
  }
  const wish = wishes.pickWish(raycaster);
  if (wish) {
    if (wishes.focused && wishes.focusedWish?.id === wish.id) return;
    focusWish(wish);
    return;
  }
  if (wishes.focused) unfocusWish();
  if (gallery.focused) hidePhoto();
});

// ---------------------------------------------------------------- gestures
const tracker = new HandTracker({
  video: $('cam-video'), canvas: $('cam-canvas'), label: $('cam-label'),
  onUpdate: (h) => onHand(h),
});

function onHand(h) {
  state.hand = { ...state.hand, ...h };
  const g = h.present ? h.gesture : Gesture.NONE;
  const prev = state.prevGesture;
  state.prevGesture = g;
  $('status-gesture').textContent = !h.present ? '🤚 未检测到手' : {
    [Gesture.OPEN]: '✋ 张开手掌',
    [Gesture.FIST]: '✊ 握拳',
    [Gesture.OK]: '👌 OK',
    [Gesture.PEACE]: '✌️ 比耶 · 看书签',
    [Gesture.NONE]: '🤚 识别中',
  }[g];
  if (g === prev || wishManager?.isModalOpen || space?.isAnyModalOpen) return;

  if (g === Gesture.OPEN) { hidePhoto(); unfocusWish(); setTarget(0); }
  else if (g === Gesture.FIST) { unfocusWish(); setTarget(1); }
  else if (g === Gesture.PEACE) { showNextWish(); }
  else if (g === Gesture.OK) {
    clearTimeout(okHideTimer);
    okHideTimer = null;
    showNextPhoto();
  } else if (prev === Gesture.OK) {
    // Small grace window against tracking jitter when holding OK
    clearTimeout(okHideTimer);
    okHideTimer = setTimeout(() => {
      if (state.prevGesture !== Gesture.OK) hidePhoto();
    }, 450);
  }
}

async function startCamera() {
  if (tracker.starting || tracker.running) return;
  $('cam').hidden = false;
  $('btn-camera').classList.add('active');
  $('btn-camera').textContent = '🖐 加载中…';
  try {
    const started = await tracker.start();
    if (!started) return;
    $('btn-camera').textContent = '🖐 手势中';
    toast('手势已开启：张掌散开、握拳聚合、散开比 OK 看照片、比耶✌️看祝福书签', 4000);
  } catch (e) {
    console.error(e);
    stopCamera();
    const msg = e?.name === 'NotAllowedError' ? '摄像头权限被拒绝了' : e?.message || '摄像头启动失败';
    toast(`${msg}，可以继续使用按钮 / 空格键 / P 键体验`, 4500);
  }
}
function stopCamera() {
  tracker.stop();
  $('cam').hidden = true;
  $('btn-camera').classList.remove('active');
  $('btn-camera').textContent = '🖐 手势控制';
  $('status-gesture').textContent = '🖱 拖动旋转 · 点击书签读祝福';
}
$('btn-camera').onclick = () => ((tracker.running || tracker.starting) ? stopCamera() : startCamera());

// intro
if (!HandTracker.supported()) {
  const note = $('intro-note');
  note.classList.add('warn');
  note.textContent = window.isSecureContext ? '当前浏览器不支持摄像头，可用按钮 / 空格键 / P 键体验。'
    : '当前不是 HTTPS 访问，浏览器禁止调用摄像头；可用按钮 / 空格键 / P 键体验。';
}
const closeIntro = () => $('intro').classList.add('hide');
$('intro-camera').onclick = () => { closeIntro(); startCamera(); };
$('intro-skip').onclick = closeIntro;

// ---------------------------------------------------------------- space, photos & wishes
let manager;
let wishManager;
const space = new SpaceController({
  getAdminToken: () => manager?.token || '',
  onSpaceReady: async () => {
    hidePhoto();
    unfocusWish();
    await Promise.all([manager.refresh(), wishManager.refresh()]);
  },
  toast,
});
manager = new PhotoManager({
  space,
  onChange: (list) => gallery.setPhotos(list),
  onTokenChange: () => {
    wishManager?.renderLists();
    // Admin login also unlocks any currently locked room immediately
    if (space.info.locked && !space.info.authorized && manager.token) {
      space.switchTo(space.slug, false);
    }
  },
  toast,
});
wishManager = new WishManager({
  space,
  onChange: (list) => {
    wishes.setWishes(list);
    if (!wishes.focused) wishManager?.setFocusBarVisible(false);
  },
  onCreated: (wish) => {
    unfocusWish();
    const yaw = wishes.animateNewWish(wish.id);
    if (yaw !== null) {
      const camYaw = Math.atan2(camera.position.x, camera.position.z);
      turnToYaw = camYaw - yaw;
      turnUntil = performance.now() + 2600;
    }
  },
  onSelectWish: (wish) => focusWish(wish),
  onStepFocus: (delta) => { wishes.stepFocus(delta); updateButtons(); },
  onUnfocus: () => unfocusWish(),
  getToken: () => manager.token,
  onInvalidToken: () => manager.setToken(''),
  toast,
});
space.switchTo(space.readSlugFromUrl(), false);
// Staggered background polling (55..75s) prevents synchronized bursts when many visitors join at once
(function scheduleSync() {
  setTimeout(async () => {
    if (document.visibilityState === 'visible' && !space.isAnyModalOpen) {
      if (!manager.isOpen) await manager.refresh();
      if (!wishManager.isModalOpen) await wishManager.refresh();
    }
    scheduleSync();
  }, 55000 + Math.random() * 20000);
})();

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let time = 0;
let focusAmt = 0;
const camLook = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  state.progress = damp(state.progress, state.target, state.target < state.progress ? 2.2 : 1.6, dt);

  const h = state.hand;
  let wantSpin = 0.12 + (1 - state.progress) * 0.05;
  if (h.present && h.gesture !== Gesture.OK && h.gesture !== Gesture.PEACE) {
    const dx = h.palm.x - 0.5;
    wantSpin = Math.abs(dx) > 0.08 ? Math.sign(dx) * (Math.abs(dx) - 0.08) * 5 : 0;
  }
  if (gallery.focused || wishes.focused || wishManager.isModalOpen || space.isAnyModalOpen) wantSpin = 0;
  if (turnToYaw !== null && performance.now() < turnUntil && !h.present && !wishes.focused) {
    const diff = Math.atan2(Math.sin(turnToYaw - tree.group.rotation.y), Math.cos(turnToYaw - tree.group.rotation.y));
    const targetVel = Math.max(-2.2, Math.min(2.2, diff * 2.4));
    state.spinVel = damp(state.spinVel, targetVel, 5, dt);
    tree.group.rotation.y += state.spinVel * dt;
  } else {
    turnToYaw = null;
    state.spinVel = damp(state.spinVel, wantSpin, 3, dt);
    tree.group.rotation.y += state.spinVel * dt;
  }

  if (h.present) {
    camLook.set(0, 0.6 + (0.5 - h.palm.y) * 3, 0);
    controls.target.lerp(camLook, 1 - Math.exp(-2 * dt));
  }
  controls.update();

  const anyFocus = gallery.focused || wishes.focused;
  focusAmt = damp(focusAmt, anyFocus ? 1 : 0, 5, dt);
  tree.update(time, state.progress, 1 - focusAmt * 0.52);
  environment.update(time, state.progress);
  gallery.update(time, state.progress, dt, camera);
  wishes.update(time, state.progress, dt, camera);
  bloom.strength = 0.56 - focusAmt * 0.24 + (1 - state.progress) * 0.08;

  composer.render();
  requestAnimationFrame(frame);
}
updateButtons();
frame();

window.__xmas = { state, gallery, wishes, tree, setTarget, showNextPhoto, hidePhoto };
