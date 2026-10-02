// Plate XII. The canary, Serinus canaria, on Sir Humphry Davy's safety lamp.
// Drawing units: 1000 x 1250, cropped by the plate. The lamp stands on the axis
// x = 500; the bird is drawn in its own frame (feet at the origin, facing right)
// and set on the ring.

import { clamp, Curve, ellipse, mix, smoothstep, type Pt } from './geom';
import { COVER, family, railPatch, type Family, type Stroke } from './hatch';
import { arc, feather, lambert, rail, shape, Sheet, specular, stipple, turned, type FeatherSpec } from './kit';
import { GAUZE_BASIS } from './lattice';
import { valueNoise } from './noise';
import { norm3, Pillow } from './pillow';
import type { Op, PlateArt } from './render';

const AX = 500, TILT = 0.16;

// lamp stations (top to bottom)
const RING = { cx: AX, cy: 384, R: 62, half: 62 * Math.cos((52 * Math.PI) / 180), tube: 10 };
const BOSS = { y0: 440, y1: 468, r: 16 };
const CAP = { y0: 468, y1: 484, r: 128 };
const GAUZE = { y0: 484, y1: 902, r: 92 };
const PILLAR = { r: 5.5, at: 112, angles: [-62, 62] };
const COLLAR = { y0: 902, y1: 950, r: 136 };
const VESSEL = { y0: 950, y1: 1104, r: 126 };
const FOOT = { y0: 1104, y1: 1124, r: 140 };
const WICK = { x: AX + 4, y: 882 };

/** Bird frame -> plate: rotate the body up about the feet, then set the feet on the ring. */
const FEET: Pt = [AX, RING.cy - RING.R - RING.tube + 0.5];
const TURN = (-17 * Math.PI) / 180;
const SCALE = 1.12;
const bird = ([x, y]: Pt): Pt => {
  const c = Math.cos(TURN), s = Math.sin(TURN);
  return [FEET[0] + SCALE * (x * c - y * s), FEET[1] + SCALE * (x * s + y * c)];
};
const foot = ([x, y]: Pt): Pt => [FEET[0] + x * SCALE, FEET[1] + y * SCALE];

// ---------- flame states, by rungs broken ----------
interface FlameState { h: number; w: number; cap: number; fill: number }
const FLAME: FlameState[] = [
  { h: 84, w: 26, cap: 0, fill: 0 },
  { h: 84, w: 26, cap: 40, fill: 0 },
  { h: 86, w: 26, cap: 84, fill: 0 },
  { h: 92, w: 27, cap: 140, fill: 0 },
  { h: 100, w: 29, cap: 0, fill: 0.55 },
  { h: 104, w: 30, cap: 0, fill: 1 },
];

export const plateXII: PlateArt = {
  // the plate crops the drawing a little: 880 x 1180 out of 1000 x 1250
  width: 880,
  height: 1180,
  origin: [62, 34],
  ops: (pitch, level) => build(pitch, level),
};

let cache: { pitch: number; base: BaseOps } | null = null;
interface BaseOps { back: Op[]; lampFront: Op[]; birdOps: Op[]; gauzeOutline: Pt[] }

function build(pitch: number, level: number): Op[] {
  if (!cache || Math.abs(cache.pitch - pitch) > 1e-6) cache = { pitch, base: buildBase(pitch) };
  const b = cache.base;
  const flame = new Sheet();
  drawInterior(flame, pitch, FLAME[Math.max(0, Math.min(5, level))]!);
  return [...b.back, ...flame.ops, ...gauzeMesh(pitch, FLAME[Math.max(0, Math.min(5, level))]!), ...b.lampFront, ...b.birdOps];
}

function buildBase(p: number): BaseOps {
  const back = new Sheet();
  ground(back, p);
  ringHalf(back, p, 'back');
  // the back pillar, seen through the gauze
  pillar(back, p, 180, 0.35);
  const front = new Sheet();
  turned(front, { cx: AX, y0: COLLAR.y0, y1: COLLAR.y1, r: (y) => COLLAR.r - 4 * smoothstep(COLLAR.y0 + 30, COLLAR.y1, y), tilt: TILT, pitch: p, topFace: true, topTone: 0.5, grooves: [COLLAR.y0 + 24, COLLAR.y0 + 30], beads: [COLLAR.y0 + 12] });
  turned(front, { cx: AX, y0: VESSEL.y0, y1: VESSEL.y1, r: (y) => VESSEL.r + 3 * Math.sin(((y - VESSEL.y0) / (VESSEL.y1 - VESSEL.y0)) * Math.PI), tilt: TILT, pitch: p, grooves: [VESSEL.y0 + 22, VESSEL.y1 - 30, VESSEL.y1 - 24], beads: [VESSEL.y0 + 30, VESSEL.y1 - 16] });
  turned(front, { cx: AX, y0: FOOT.y0, y1: FOOT.y1, r: (y) => FOOT.r - 8 * smoothstep(FOOT.y0 + 10, FOOT.y1, y), tilt: TILT, pitch: p * 0.9, topFace: true, topTone: 0.46 });
  // the collar's lip sits over the vessel: re-cut the line between them
  front.line(arc(AX, COLLAR.y1, COLLAR.r - 4, TILT), () => p * 0.7, undefined, true);
  for (const a of PILLAR.angles) pillar(front, p, a, 1);
  turned(front, { cx: AX, y0: CAP.y0, y1: CAP.y1, r: () => CAP.r, tilt: TILT, pitch: p * 0.92, topFace: true, topTone: 0.56, beads: [CAP.y1 - 4] });
  turned(front, { cx: AX, y0: BOSS.y0, y1: BOSS.y1, r: (y) => BOSS.r + 5 * smoothstep(BOSS.y0 + 16, BOSS.y1, y), tilt: TILT, pitch: p * 0.8, topFace: true, topTone: 0.62, parallels: false });
  ringHalf(front, p, 'front');
  const b = new Sheet();
  canary(b, p);
  return { back: back.ops, lampFront: front.ops, birdOps: b.ops, gauzeOutline: gauzeOutline() };
}

// ---------- ground ----------

function ground(s: Sheet, p: number) {
  const y0 = FOOT.y1 + TILT * FOOT.r + 2;
  const fams: Family[] = [];
  // the table: horizontal strokes thinning out to the sides, broken by the cast shadow
  const P = (u: number, v: number): Pt => [AX - 330 + 660 * u, y0 - 26 + 70 * v];
  fams.push(
    family(P, {
      pitch: p * 1.25,
      constant: 'v',
      tone: (x, y) => {
        const ex = Math.abs(x - AX) / 330, ey = (y - (y0 + 6)) / 40;
        const fall = clamp(1 - ex * ex - ey * ey * 0.9);
        // cast shadow from a light at the upper right: falls to the lower left
        const sx = (x - (AX - 60)) / 190, sy = (y - (y0 + 6)) / 22;
        const shade = smoothstep(1.0, 0.35, sx * sx + sy * sy);
        return fall * (0.42 - 0.38 * shade);
      },
      cover: COVER.primary,
      taper: 4,
      tremor: 0.12,
      dotBelow: 0.07,
      seed: 41,
    }),
  );
  s.ink(fams);
}

// ---------- the ring handle (a torus, its plane turned 55 degrees from the picture) ----------

function ringPoint(a: number, off: number): Pt {
  // centreline point, offset across the tube in screen space
  const x = RING.cx + RING.half * Math.sin(a), y = RING.cy - RING.R * Math.cos(a);
  const dx = RING.half * Math.cos(a), dy = RING.R * Math.sin(a);
  const l = Math.hypot(dx, dy) || 1;
  return [x + (dy / l) * off, y - (dx / l) * off];
}

function ringHalf(s: Sheet, p: number, side: 'front' | 'back') {
  // front half: a in (0, pi) has sin a > 0 -> nearer the viewer
  const a0 = side === 'front' ? 0.02 : Math.PI, a1 = side === 'front' ? Math.PI - 0.02 : 2 * Math.PI;
  const t = RING.tube;
  const P = (u: number, v: number): Pt => ringPoint(a0 + (a1 - a0) * u, (v * 2 - 1) * t);
  const outline: Pt[] = [];
  for (let k = 0; k <= 60; k++) outline.push(P(k / 60, 0));
  for (let k = 60; k >= 0; k--) outline.push(P(k / 60, 1));
  s.erase(outline, p * 0.8);
  const tone = (_x: number, _y: number, u: number, v: number) => {
    const a = a0 + (a1 - a0) * u;
    const dx = RING.half * Math.cos(a), dy = RING.R * Math.sin(a);
    const l = Math.hypot(dx, dy) || 1;
    const f = v * 2 - 1;
    const n = norm3([(dy / l) * f, (-dx / l) * f, Math.sqrt(Math.max(0, 1 - f * f)) + 0.05]);
    const depth = side === 'back' ? 0.62 : 1;
    return clamp((0.12 + 0.5 * lambert(n) + 0.95 * specular(n, 26)) * depth);
  };
  s.ink(
    [
      family(P, { pitch: p * 0.62, constant: 'v', tone, cover: COVER.primary, taper: 0.8, tremor: 0.02 }),
      family(P, { pitch: p * 0.8, constant: 'u', tone, cover: COVER.cross, taper: 0.4, tremor: 0.02 }),
    ],
    outline,
    true,
  );
}

// ---------- pillars ----------

function pillar(s: Sheet, p: number, deg: number, strength: number) {
  const a = (deg * Math.PI) / 180;
  const cx = AX + PILLAR.at * Math.sin(a);
  const dy = TILT * PILLAR.at * Math.cos(a);
  const y0 = CAP.y1 + dy - 2, y1 = COLLAR.y0 + dy + 2;
  if (strength < 1) {
    // behind the gauze: a dim rod, drawn as two hairlines
    const pts = (off: number): Pt[] => Array.from({ length: 40 }, (_, k) => [cx + off, y0 + ((y1 - y0) * k) / 39] as Pt);
    s.line(pts(-2.4), (_x, y) => p * 0.22 * strength * (0.6 + 0.4 * Math.sin(y * 0.05)));
    s.line(pts(2.2), () => p * 0.12 * strength);
    return;
  }
  turned(s, {
    cx, y0, y1, r: () => PILLAR.r, tilt: TILT, pitch: p * 0.5, parallels: false, halo: p * 1.1,
    tone: (n, th) => clamp(0.08 + 0.55 * lambert(n) + 1.1 * specular(n, 22) + 0.1 * smoothstep(0.7, 1, -Math.sin(th))),
  });
}

// ---------- gauze and flame ----------

function gauzeOutline(): Pt[] {
  return [
    ...arc(AX, GAUZE.y0, GAUZE.r, -TILT),
    ...Array.from({ length: 20 }, (_, k) => [AX + GAUZE.r, GAUZE.y0 + ((GAUZE.y1 - GAUZE.y0) * k) / 19] as Pt),
    ...arc(AX, GAUZE.y1, GAUZE.r, TILT).reverse(),
    ...Array.from({ length: 20 }, (_, k) => [AX - GAUZE.r, GAUZE.y1 - ((GAUZE.y1 - GAUZE.y0) * k) / 19] as Pt),
  ];
}

/** Flame glow at a point, for the wires and the interior. */
function glowAt(x: number, y: number, f: FlameState): number {
  const fy = WICK.y - f.h * 0.42;
  const d = Math.hypot((x - WICK.x) / 1.2, y - fy);
  let g = 0.55 * Math.exp(-(d * d) / (2 * 46 * 46));
  if (f.fill) {
    const top = GAUZE.y1 - (GAUZE.y1 - GAUZE.y0 - 30) * f.fill;
    g = Math.max(g, 0.62 * smoothstep(top - 40, top + 80, y) * (0.75 + 0.25 * valueNoise(x / 30, y / 40, 9)));
  }
  return g;
}

function flameOutline(cx: number, base: number, h: number, w: number): Pt[] {
  const pts: Pt[] = [];
  const N = 48;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    // a teardrop: round below, drawn up to a point
    const t = (1 - Math.cos(a)) / 2; // 0 at bottom .. 1 at top
    const x = cx + w * Math.sin(a) * Math.pow(1 - t, 0.85) * (0.35 + 0.9 * Math.sqrt(t + 0.02));
    const y = base - h * t;
    pts.push([x, y]);
  }
  return pts;
}

function drawInterior(s: Sheet, p: number, f: FlameState) {
  const inner = gauzeOutline();
  // interior glow: soft stipple around the flame
  s.dots(stipple(inner, (x, y) => glowAt(x, y, f) * 0.8, p * 0.8, 17), inner);
  // wick tube and pricker
  const tube = ellipse(WICK.x, WICK.y + 12, 6, 14);
  s.erase(tube);
  s.line(Array.from({ length: 12 }, (_, k) => [WICK.x - 4, WICK.y + 2 + k * 2] as Pt), () => p * 0.35);
  s.line(Array.from({ length: 12 }, (_, k) => [WICK.x + 4.5, WICK.y + 2 + k * 2] as Pt), () => p * 0.2);
  s.line(
    Array.from({ length: 30 }, (_, k) => {
      const t = k / 29;
      return [WICK.x - 26 + 8 * Math.sin(t * 2.2), WICK.y + 22 - 52 * t] as Pt;
    }),
    (_x, _y, t) => p * (0.28 - 0.12 * t),
  );
  if (f.fill) {
    // the lamp has fired: firedamp burns inside the gauze, held by it
    const top = GAUZE.y1 - (GAUZE.y1 - GAUZE.y0 - 30) * f.fill;
    const tongues: Stroke[] = [];
    const nT = Math.round((GAUZE.r * 2) / (p * 0.75));
    for (let i = 0; i < nT; i++) {
      const x0 = AX - GAUZE.r + 6 + (i / (nT - 1)) * (GAUZE.r * 2 - 12);
      const st: Stroke = [];
      const len = (GAUZE.y1 - top) * (0.55 + 0.45 * valueNoise(i * 1.7, 3, 4));
      for (let k = 0; k <= 50; k++) {
        const t = k / 50;
        const y = GAUZE.y1 - 6 - len * t;
        const x = x0 + Math.sin(t * 7 + i) * 6 * t + (AX - x0) * 0.35 * t * t;
        const tone = Math.pow(1 - t, 0.7) * 0.95 * (0.55 + 0.45 * Math.cos(((x - AX) / GAUZE.r) * 1.4));
        st.push(x, y, COVER.single(tone) * p * 0.75);
      }
      tongues.push(st);
    }
    s.ink({ strokes: tongues, dots: [] }, inner, true);
  }
  // the flame: contour lines drawn up to its point, a dark blue root at the wick
  const out = flameOutline(WICK.x, WICK.y, f.h, f.w);
  s.erase(out, p * 0.3);
  const left = new Curve(out.slice(0, 25)); // bottom -> tip via the right side
  const right = new Curve(out.slice(24).reverse()); // bottom -> tip via the left side
  const P = railPatch(left, right);
  s.ink(
    [
      family(P, {
        pitch: p * 0.5,
        constant: 'v',
        tone: (_x, y, _u, v) => {
          const core = Math.pow(Math.sin(Math.PI * v), 0.6);
          const root = smoothstep(WICK.y - 4, WICK.y - 16, y);
          return clamp(0.25 + 0.85 * core * root);
        },
        cover: COVER.single,
        taper: 1.4,
        tremor: 0.04,
        dotBelow: 0.05,
      }),
    ],
    out,
    true,
  );
  // firedamp cap: a pale, ghostly cone above the flame
  if (f.cap) {
    const capOut = flameOutline(WICK.x, WICK.y - f.h * 0.55, f.cap + f.h * 0.5, f.w * 1.9);
    const L2 = new Curve(capOut.slice(0, 25));
    const R2 = new Curve(capOut.slice(24).reverse());
    s.ink(
      family(railPatch(L2, R2), {
        pitch: p * 0.9,
        constant: 'v',
        tone: (_x, y, _u, v) => clamp(0.62 * Math.pow(Math.sin(Math.PI * v), 0.5) * smoothstep(WICK.y - f.h * 0.5, WICK.y - f.h * 0.95, y)),
        cover: COVER.single,
        taper: 3,
        tremor: 0.25,
        dotBelow: 0.04,
      }),
      capOut,
      true,
    );
  }
}

function gauzeMesh(p: number, f: FlameState): Op[] {
  const s = new Sheet();
  const outline = gauzeOutline();
  const R = GAUZE.r;
  // lattice basis scaled so its short vector is one wire pitch
  const [b1, b2] = GAUZE_BASIS;
  const scale = (p * 1.02) / Math.hypot(b1[0], b1[1]);
  const B1: Pt = [b1[0] * scale, b1[1] * scale], B2: Pt = [b2[0] * scale, b2[1] * scale];
  // surface coordinates: sigma = arc length across the front, y = height
  const toScreen = (sig: number, y: number): Pt | null => {
    const th = sig / R;
    if (Math.abs(th) > Math.PI / 2) return null;
    return [AX + R * Math.sin(th), y + TILT * R * Math.cos(th)];
  };
  const wireTone = (x: number, y: number, th: number) => {
    const n = norm3([Math.sin(th), 0, Math.cos(th)]);
    const base = 0.24 + 0.4 * lambert(n) + 0.5 * specular(n, 14);
    // the double gauze at the top reads denser
    const cap = y < GAUZE.y0 + 52 ? 0.12 : 0;
    return clamp(base + cap + glowAt(x, y, f) * 0.9);
  };
  const sigMax = (R * Math.PI) / 2;
  const fam = (dir: Pt, step: Pt): { lit: Stroke[]; dark: Stroke[] } => {
    const lit: Stroke[] = [], dark: Stroke[] = [];
    // walk lines through lattice points k*step, along dir
    const span = GAUZE.y1 - GAUZE.y0 + 40;
    for (let k = -400; k <= 400; k++) {
      const ox = k * step[0], oy = GAUZE.y0 - 20 + k * step[1];
      // parameter range that keeps the line inside the surface rectangle
      const n = 600;
      let run: Stroke = [], runDark: Stroke = [];
      const len = Math.hypot(dir[0], dir[1]);
      const tMax = (span + 2 * sigMax) / len;
      for (let j = -n; j <= n; j++) {
        const t = (j / n) * tMax;
        const sig = ox + dir[0] * t, y = oy + dir[1] * t;
        const q = y >= GAUZE.y0 && y <= GAUZE.y1 ? toScreen(sig, y) : null;
        if (!q) {
          if (run.length > 3) lit.push(run);
          if (runDark.length > 3) dark.push(runDark);
          run = []; runDark = [];
          continue;
        }
        const th = sig / R;
        const fore = Math.max(0.25, Math.cos(th)); // wires crowd at the limbs; thin them there
        const behind = flameBright(q[0], q[1], f);
        if (behind > 0.78) {
          // halation: the brightest flame swallows the wire
          if (run.length > 3) lit.push(run);
          if (runDark.length > 3) dark.push(runDark);
          run = []; runDark = [];
        } else if (behind > 0.3) {
          // over the flame the wires print as dark lines: back-lit
          runDark.push(q[0], q[1], p * 0.2);
          if (run.length > 3) lit.push(run);
          run = [];
        } else {
          run.push(q[0], q[1], COVER.single(wireTone(q[0], q[1], th)) * p * 0.62 * (0.55 + 0.45 * fore));
          if (runDark.length > 3) dark.push(runDark);
          runDark = [];
        }
      }
      if (run.length > 3) lit.push(run);
      if (runDark.length > 3) dark.push(runDark);
    }
    return { lit, dark };
  };
  const A = fam(B1, B2); // near-horizontal wires
  const Bf = fam(B2, B1); // the slanted family
  s.cut([...A.dark, ...Bf.dark], outline);
  s.ink({ strokes: [...A.lit, ...Bf.lit], dots: [] }, outline, true);
  // seam of the double gauze, and the limbs of the cylinder
  s.line(arc(AX, GAUZE.y0 + 52, R, TILT), () => p * 0.45, outline, true);
  s.line(arc(AX, GAUZE.y0 + 55, R, TILT), (x) => p * 0.3 * (0.4 + 0.6 * smoothstep(AX - R, AX + R, x)), outline);
  // the limbs: the engraver closes the cylinder with a clean line on each side
  const limb = (x: number): Pt[] => Array.from({ length: 60 }, (_, k) => [x, GAUZE.y0 + 2 + ((GAUZE.y1 - GAUZE.y0 - 2) * k) / 59] as Pt);
  s.line(limb(AX - R + 0.9), (_x, y) => p * (0.42 + 0.3 * glowAt(AX - R, y, f)));
  s.line(limb(AX + R - 0.9), () => p * 0.3);
  return s.ops;
}

/** How bright the flame (or the fired gauze) is behind a point. */
function flameBright(x: number, y: number, f: FlameState): number {
  const ty = (WICK.y - y) / f.h;
  let b = 0;
  if (ty > 0 && ty < 1) {
    const half = f.w * Math.pow(1 - ty, 0.85) * (0.35 + 0.9 * Math.sqrt(ty + 0.02));
    const ax = Math.abs(x - WICK.x) / Math.max(1, half);
    b = ax < 1 ? (1 - ax * ax) * smoothstep(0, 0.15, ty) : 0;
  }
  if (f.fill) {
    const top = GAUZE.y1 - (GAUZE.y1 - GAUZE.y0 - 30) * f.fill;
    b = Math.max(b, 0.55 * smoothstep(top, top + 120, y) * (0.6 + 0.4 * Math.cos(((x - AX) / GAUZE.r) * 1.3)));
  }
  return b;
}

// ---------- the canary ----------

// Body and head in the bird frame: forehead, crown, nape, back, rump, tail root,
// vent, belly, breast, throat, chin.
const BODY_D =
  'M170 -172 C163 -195 148 -207 127 -207 C105 -207 89 -197 81 -183 C74 -171 66 -161 55 -151 ' +
  'C35 -133 6 -119 -28 -99 C-50 -87 -64 -75 -76 -61 L-86 -46 L-74 -25 ' +
  'C-58 -13 -30 -1 -2 0 C30 1 66 -14 98 -44 C124 -68 148 -94 160 -120 C165 -129 169 -136 172 -142 ' +
  'C172 -152 171 -162 170 -172 Z';
// Rails for the flow lines: over the top (forehead to tail root) and under (chin to vent).
const DORSAL_D = 'M171 -170 C163 -195 148 -207 127 -207 C105 -207 89 -197 81 -183 C74 -171 66 -161 55 -151 C35 -133 6 -119 -28 -99 C-50 -87 -64 -75 -76 -61 L-86 -46';
const VENTRAL_D = 'M172 -142 C169 -136 165 -129 160 -120 C148 -94 124 -68 98 -44 C66 -14 30 1 -2 0 C-30 -1 -58 -13 -74 -25';
const WING_D =
  'M101 -121 C96 -98 72 -76 30 -60 C-10 -45 -60 -30 -100 -20 L-122 -14 ' +
  'C-104 -32 -76 -54 -40 -78 C-6 -101 34 -124 66 -137 C84 -142 98 -136 101 -121 Z';
const BEAK_UP = 'M169 -173 C182 -173 199 -166 207 -153 C196 -151 180 -151 165 -150 C167 -158 168 -166 169 -173 Z';
const BEAK_LO = 'M165 -150 C180 -150 194 -150 205 -150 C196 -144 182 -139 169 -138 C167 -142 166 -146 165 -150 Z';
const EYE: Pt = [142, -171];

function canary(s: Sheet, p: number) {
  const P = p * 0.8; // feathers are cut finer than the brass
  const body = shape(BODY_D, bird);
  const wing = shape(WING_D, bird);
  const relief = new Pillow([body], 46, 3);
  const wingRelief = new Pillow([wing], 26, 3);
  const wingEdge = new Curve(shape('M101 -121 C96 -98 72 -76 30 -60 C-10 -45 -60 -30 -100 -20 L-122 -14', bird));

  const bodyTone = (x: number, y: number) => {
    const n = relief.normal(x, y);
    let t = 0.24 + 0.9 * Math.pow(lambert(n), 0.85);
    // the folded wing throws a soft shadow on the flank below it
    const below = distBelow(wingEdge, x, y);
    if (below > 0 && below < 22) t *= 0.55 + 0.45 * smoothstep(0, 22, below);
    return clamp(t);
  };

  // tail first: the body overlaps its root
  tail(s, P);

  // head and body: flow lines from the bill back to the tail, broken into flicks
  s.erase(body, p * 1.1);
  const top = rail(DORSAL_D, bird), under = rail(VENTRAL_D, bird);
  const patch = railPatch(top, under, 0);
  const flow = family(patch, {
    pitch: P * 0.95,
    constant: 'v',
    tone: (x, y) => bodyTone(x, y),
    cover: COVER.primary,
    taper: 1.6,
    tremor: 0.05,
    scallop: 4.5,
    dotBelow: 0.07,
    seed: 3,
  });
  // in the lights, a second family wraps round the body
  const wrap = family(railPatch(top, under, 0.12), {
    pitch: P * 1.05,
    constant: 'u',
    tone: (x, y) => bodyTone(x, y),
    cover: COVER.cross,
    taper: 2,
    tremor: 0.08,
    phase: 0.3,
    seed: 5,
  });
  s.ink([flow, wrap], body);
  // soft feathering on the face and the vent: stipple
  const face = shape('M168 -170 C160 -158 150 -146 156 -132 C166 -134 171 -150 168 -170 Z', bird);
  s.dots(stipple(face, (x, y) => bodyTone(x, y) * 0.8, P * 0.8, 21), face);
  const vent = shape('M-74 -25 C-60 -16 -36 -9 -14 -8 C-26 -18 -50 -26 -70 -38 Z', bird);
  s.dots(stipple(vent, (x, y) => bodyTone(x, y) * 0.7, P * 0.85, 22), vent);

  // the shadow-side contour: a clean cut line where the bird meets the dark
  const back = shape('M55 -151 C35 -133 6 -119 -28 -99 C-50 -87 -64 -75 -76 -61', bird);
  s.line(back, (_x, _y, f) => P * (0.35 + 0.25 * Math.sin(Math.PI * f)));
  const belly = shape('M98 -44 C66 -14 30 1 -2 0 C-30 -1 -58 -13 -74 -25', bird);
  s.line(belly, (_x, _y, f) => P * (0.5 - 0.2 * f));

  wingFeathers(s, P, wingRelief);

  // bill: two mandibles, lines running to the tip, the gape cut dark
  const up = shape(BEAK_UP, bird), lo = shape(BEAK_LO, bird);
  s.erase(lo, P * 0.6);
  const culmen = rail('M169 -173 C182 -173 199 -166 207 -153', bird);
  const tomium = rail('M165 -150 C180 -151 196 -151 207 -153', bird);
  const lower = rail('M169 -138 C182 -139 196 -144 205 -150', bird);
  const gape = rail('M165 -150 C180 -150 194 -150 205 -150', bird);
  const billTone = (lift: number) => (_x: number, _y: number, u: number, v: number) =>
    clamp(lift + 0.35 * Math.sin(Math.PI * v) - 0.2 * u + 0.25 * specular(norm3([0.2, -0.9 + v, 0.5]), 8) * (1 - u));
  s.ink(family(railPatch(gape, lower), { pitch: P * 0.62, constant: 'v', tone: billTone(0.3), cover: COVER.single, taper: 1, tremor: 0.02 }), lo);
  s.erase(up, P * 0.6);
  s.ink(family(railPatch(culmen, tomium), { pitch: P * 0.6, constant: 'v', tone: billTone(0.46), cover: COVER.single, taper: 1, tremor: 0.02 }), up);
  s.line(shape('M165 -150 C180 -151 196 -151 207 -153', bird), () => P * 0.55, undefined, true);
  // nostril
  s.line(shape('M174 -166 C177 -167 180 -166 182 -164', bird), () => P * 0.4, undefined, true);

  // eye: a dark pupil, a clean ring, the catchlight toward the light
  const [ex, ey] = bird(EYE);
  const eyeR = 8.6;
  s.erase(ellipse(ex, ey, eyeR + 2.2, eyeR + 2.2), 0);
  s.line(ellipse(ex, ey, eyeR + 3.4, eyeR + 3.2, 0, 64).concat([ellipse(ex, ey, eyeR + 3.4, eyeR + 3.2, 0, 64)[0]!]), (x, y) => P * (0.32 + 0.22 * clamp((ex - x + (y - ey)) / 14 + 0.5)));
  s.dots([ex + 3.1, ey - 3.3, 2.3, ex - 3.6, ey + 3.8, 0.8]);

  legs(s, P);
}

/** Positive distance of a point below a curve (along +y), or -1. */
function distBelow(c: Curve, x: number, y: number): number {
  let best = -1;
  const pts = c.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
    if ((x - ax) * (x - bx) > 0) continue;
    const t = (x - ax) / (bx - ax || 1e-9);
    const cy = ay + (by - ay) * t;
    if (y >= cy) best = best < 0 ? y - cy : Math.min(best, y - cy);
  }
  return best;
}

function tail(s: Sheet, P: number) {
  // six rectrices, outer ones beneath; tips staggered, a slight notch
  const specs: FeatherSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const base = bird([-72 + i * 1.5, -38 - i * 1.2]);
    // outer feathers lie lowest and reach a little further: a shallow notch
    const tip = bird([-196 + i * 4.5, 44 - i * 4.2]);
    specs.push({
      base, tip, width: 25 + i * 0.6, bend: 0.025, asym: 0.4, point: 0.1,
      tone: (_x, _y, along, across) => clamp((0.36 + 0.3 * (i / 5)) * (0.7 + 0.5 * along) + 0.14 * across),
    });
  }
  for (const f of specs) feather(s, f, P * 0.95, { halo: P * 0.9, fringe: 0.4 });
  // undertail coverts: soft and short, over the root
  const coverts = shape('M-60 -24 C-74 -20 -92 -12 -112 -4 C-100 -16 -86 -30 -76 -44 C-70 -36 -64 -30 -60 -24 Z', bird);
  s.erase(coverts, P * 0.6);
  s.dots(stipple(coverts, (x, y) => 0.32 + 0.2 * valueNoise(x / 6, y / 6, 2), P * 0.75, 31), coverts);
}

function wingFeathers(s: Sheet, P: number, relief: Pillow) {
  const lit = (x: number, y: number) => clamp(0.12 + 0.95 * Math.pow(lambert(relief.normal(x, y)), 1.1));
  const tone = (k: number) => (x: number, y: number, along: number, across: number) =>
    clamp(lit(x, y) * (0.5 + 0.55 * smoothstep(0.1, 0.75, along)) * (1 + 0.18 * across) * k + 0.08 * Math.max(0, across));
  // primaries: long and pointed, outermost reaching furthest along the tail
  for (let i = 0; i < 6; i++) {
    feather(s, {
      base: bird([28 - i * 3, -62 - i * 3]), tip: bird([-122 + i * 11, -14 - i * 4.6]),
      width: 17, bend: 0.04, asym: 0.32, point: 0.85, tone: tone(0.85),
    }, P * 0.9, { halo: P * 0.7 });
  }
  // secondaries
  for (let i = 0; i < 5; i++) {
    feather(s, {
      base: bird([44 - i * 2, -82 - i * 2.5]), tip: bird([-58 + i * 11, -36 - i * 5.2]),
      width: 20, bend: 0.05, asym: 0.36, point: 0.3, tone: tone(0.9),
    }, P * 0.9, { halo: P * 0.7 });
  }
  // tertials: broad, round-tipped, lying over the rest
  for (let i = 0; i < 3; i++) {
    feather(s, {
      base: bird([58 - i * 4, -124 + i * 5]), tip: bird([-76 + i * 13, -48 - i * 9]),
      width: 27 - i * 2, bend: 0.06, asym: 0.45, point: 0.1, tone: tone(1),
    }, P * 0.92, { halo: P * 0.75 });
  }
  // greater and median coverts: rows of short feathers with scalloped tips
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    feather(s, {
      base: bird(mix([90, -116], [30, -104], t)), tip: bird(mix([62, -80], [-14, -66], t)),
      width: 23, bend: 0.06, asym: 0.5, point: 0.05, tone: tone(1.05),
    }, P * 0.85, { halo: P * 0.42 });
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    feather(s, {
      base: bird(mix([97, -126], [44, -120], t)), tip: bird(mix([80, -100], [18, -92], t)),
      width: 19, bend: 0.05, asym: 0.5, point: 0, tone: tone(1.1),
    }, P * 0.8, { halo: P * 0.4, shaft: false });
  }
  // lesser coverts: small scale-feathers at the bend
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const b = mix([100, -130], [40, -128], t);
    feather(s, {
      base: bird([b[0], b[1] - 4]), tip: bird([b[0] - 18, b[1] + 12]),
      width: 12, bend: 0.1, point: 0, tone: tone(1.1),
    }, P * 0.75, { halo: P * 0.55, shaft: false });
  }
}

function legs(s: Sheet, P: number) {
  // tarsus, mostly hidden by the belly feathers; scutes cut across it
  const tars = shape('M3 -24 C6 -16 7 -8 7 -1 L1 -1 C1 -8 0 -16 -2 -24 Z', foot);
  s.erase(tars, P * 0.5);
  const tl = rail('M-2 -24 C0 -16 1 -8 1 -1', foot), tr = rail('M3 -24 C6 -16 7 -8 7 -1', foot);
  s.ink(family(railPatch(tl, tr), { pitch: P * 0.7, constant: 'u', tone: (_x, _y, _u, v) => 0.25 + 0.5 * v, cover: COVER.single, taper: 0.2, tremor: 0 }), tars);
  // toes wrap the ring: three forward over the near side, the hind toe behind
  const toes: [string, number][] = [
    ['M4 -3 C13 -5 22 -3 27 3 C30 7 31 11 30 15', 5.6],
    ['M5 -1 C14 -1 21 3 24 9 C26 13 26 17 24 20', 5.2],
    ['M1 -3 C-7 -5 -15 -3 -20 3 C-23 7 -24 11 -22 14', 5.4],
  ];
  for (const [d, w] of toes) {
    const c = rail(d, foot);
    const outline: Pt[] = [];
    for (let k = 0; k <= 30; k++) {
      const t = k / 30, q = c.at(t), n = c.normal(t), hw = (w / 2) * (1 - 0.55 * t);
      outline.push([q[0] + n[0] * hw, q[1] + n[1] * hw]);
    }
    for (let k = 30; k >= 0; k--) {
      const t = k / 30, q = c.at(t), n = c.normal(t), hw = (w / 2) * (1 - 0.55 * t);
      outline.push([q[0] - n[0] * hw, q[1] - n[1] * hw]);
    }
    s.erase(outline, P * 0.55);
    const a = new Curve(outline.slice(0, 31)), b = new Curve(outline.slice(31).reverse());
    s.ink(
      [
        family(railPatch(a, b), { pitch: P * 0.5, constant: 'v', tone: (_x, _y, u, v) => clamp(0.85 - 0.45 * v - 0.15 * u), cover: COVER.single, taper: 0.6, tremor: 0 }),
      ],
      outline,
      true,
    );
    s.line(outline.slice(31), () => P * 0.32);
    // scutes across the toe
    const sc: Stroke[] = [];
    for (let t = 0.12; t < 0.78; t += 0.14) {
      const q = c.at(t), n = c.normal(t), hw = (w / 2) * (1 - 0.55 * t);
      sc.push([q[0] + n[0] * hw, q[1] + n[1] * hw, P * 0.3, q[0] - n[0] * hw, q[1] - n[1] * hw, P * 0.3]);
    }
    s.cut(sc, outline);
    // the claw: a curved dark horn, outlined
    const end = c.at(1), tg = c.tangent(1);
    const claw: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      claw.push([end[0] + tg[0] * 6 * t - tg[1] * 2.5 * t * t, end[1] + tg[1] * 6 * t + tg[0] * 2.5 * t * t]);
    }
    s.line(claw, (_x, _y, f) => P * 0.5 * (1 - f));
  }
  // feathered thigh over the top of the leg
  const thigh = shape('M-14 -40 C-2 -26 18 -22 28 -32 C22 -46 2 -52 -14 -40 Z', bird);
  void thigh;
}
