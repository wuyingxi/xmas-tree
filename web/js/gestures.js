// Pure gesture classification from 21 MediaPipe hand landmarks (normalized coords).
// Landmark ids: 0 wrist, 4 thumb tip, 5/9/13/17 finger MCPs, 6/10/14/18 PIPs, 8/12/16/20 tips.

export const Gesture = Object.freeze({
  NONE: 'none',
  OPEN: 'open',   // ✋ scatter
  FIST: 'fist',   // ✊ gather
  OK: 'ok',       // 👌 show photo
  PEACE: 'peace', // ✌️ show wish bookmark
});

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

const FINGERS = [ // [tip, pip, mcp]
  [8, 6, 5],    // index
  [12, 10, 9],  // middle
  [16, 14, 13], // ring
  [20, 18, 17], // pinky
];

export function analyzeHand(lm) {
  const wrist = lm[0];
  const size = d(wrist, lm[9]) || 1e-6;
  const extended = FINGERS.map(([tip, pip, mcp]) => {
    const tipW = d(lm[tip], wrist);
    const pipW = d(lm[pip], wrist);
    return tipW > pipW * 1.12 && d(lm[tip], lm[mcp]) > size * 0.45;
  });
  const curl = FINGERS.reduce((s, [tip]) => s + d(lm[tip], wrist), 0) / (4 * size);
  const pinch = d(lm[4], lm[8]) / size;
  const thumbOut = d(lm[4], lm[5]) / size;
  const peaceSpread = d(lm[8], lm[12]) / size;
  // palm center = average of wrist + MCPs
  const ids = [0, 5, 9, 13, 17];
  const palm = {
    x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length,
    y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length,
  };
  return { extended, curl, pinch, thumbOut, peaceSpread, palm, size };
}

export function classify(lm) {
  if (!lm || lm.length < 21) return Gesture.NONE;
  const { extended, curl, pinch, thumbOut, peaceSpread } = analyzeHand(lm);
  const [index, middle, ring, pinky] = extended;
  const others = [middle, ring, pinky].filter(Boolean).length;
  const count = extended.filter(Boolean).length;

  if (pinch < 0.38 && others >= 2) return Gesture.OK;
  if (index && middle && !ring && !pinky && pinch > 0.45 && peaceSpread > 0.16) return Gesture.PEACE;
  if (count >= 4 && pinch > 0.5 && thumbOut > 0.45) return Gesture.OPEN;
  if (count <= 1 && curl < 1.35) return Gesture.FIST;
  if (count === 4 && pinch > 0.45) return Gesture.OPEN;
  return Gesture.NONE;
}

/** Requires a gesture to be seen for `frames` consecutive frames before reporting it. */
export class GestureStabilizer {
  constructor(frames = 4) {
    this.frames = frames;
    this.candidate = Gesture.NONE;
    this.count = 0;
    this.stable = Gesture.NONE;
  }
  push(g) {
    if (g === this.candidate) this.count++;
    else { this.candidate = g; this.count = 1; }
    if (this.count >= this.frames && this.stable !== g) this.stable = g;
    return this.stable;
  }
  reset() { this.candidate = Gesture.NONE; this.count = 0; this.stable = Gesture.NONE; }
}
