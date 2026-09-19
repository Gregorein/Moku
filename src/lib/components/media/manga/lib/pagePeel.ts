export type PeelCorner = "br" | "bl" | "tr" | "tl";

export interface PeelGeometry {
  outgoingClip:  string;
  holeClip:      string;
  flapClip:      string;
  flapTransform: string;
  creaseX:       number;
  creaseY:       number;
  creaseLength:  number;
  boxW:          number;
  boxH:          number;
  pageShadeToX:  number;
  pageShadeToY:  number;
  flapShadeToX:  number;
  flapShadeToY:  number;
}

export const PEEL_MS = 500;
export const FLIP_MS = 560;

/** `full` folds the whole box (single page). `left`/`right` stop the crease at the spine. */
export type FoldHalf = "full" | "left" | "right";

type Pt = [number, number];

const EPS = 1e-6;

const CORNER: Record<PeelCorner, (w: number, h: number) => Pt> = {
  br: (w, h) => [w, h],
  bl: (w, h) => [0, h],
  tr: (w, h) => [w, 0],
  tl: (w, h) => [0, 0],
};

/** Pull direction over progress: 45° bottom-corner triangle → almost vertical crease. */
const PULL_ARC: Record<PeelCorner, readonly [number, number]> = {
  br: [Math.PI * 1.25, Math.PI],
  bl: [-Math.PI / 4, 0],
  tr: [Math.PI * 0.75, Math.PI],
  tl: [Math.PI / 4, 0],
};

function pullUnit(corner: PeelCorner, t: number): Pt {
  const [a0, a1] = PULL_ARC[corner];
  const a = a0 + (a1 - a0) * t;
  return [Math.cos(a), Math.sin(a)];
}

function foldVerts(w: number, h: number, fold: FoldHalf): Pt[] {
  if (fold === "right") return [[w / 2, 0], [w, 0], [w, h], [w / 2, h]];
  if (fold === "left")  return [[0, 0], [w / 2, 0], [w / 2, h], [0, h]];
  return rectVerts(w, h);
}

function sClear(C: Pt, u: Pt, verts: Pt[], pad: number): number {
  let m = 0;
  for (const V of verts) {
    m = Math.max(m, 2 * dot(sub(V, C), u));
  }
  return m + pad;
}

function poly(points: Pt[]): string {
  if (points.length < 3) return "polygon(0px 0px, 0px 0px, 0px 0px)";
  return `polygon(${points.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(",")})`;
}

function sub(a: Pt, b: Pt): Pt { return [a[0] - b[0], a[1] - b[1]]; }
function dot(a: Pt, b: Pt): number { return a[0] * b[0] + a[1] * b[1]; }
function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function len(a: Pt): number { return Math.hypot(a[0], a[1]); }

function rectVerts(w: number, h: number): Pt[] {
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

/** Keep vertices on the keepNormal side of the line through origin. */
function clipHalfPlane(verts: Pt[], origin: Pt, keepNormal: Pt): Pt[] {
  if (verts.length < 3) return [];
  const out: Pt[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const da = dot(sub(a, origin), keepNormal);
    const db = dot(sub(b, origin), keepNormal);
    const aIn = da >= -EPS;
    const bIn = db >= -EPS;
    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      out.push(lerp(a, b, da / (da - db)));
    } else if (!aIn && bIn) {
      out.push(lerp(a, b, da / (da - db)));
      out.push(b);
    }
  }
  return out;
}

function reflectPt(p: Pt, M: Pt, n: Pt): Pt {
  const d = dot(sub(p, M), n);
  return [p[0] - 2 * d * n[0], p[1] - 2 * d * n[1]];
}

function reflectPoly(verts: Pt[], M: Pt, n: Pt): Pt[] {
  return verts.map(p => reflectPt(p, M, n)).reverse();
}

function creaseHits(M: Pt, n: Pt, w: number, h: number): Pt[] {
  const edges: [Pt, Pt][] = [
    [[0, 0], [w, 0]],
    [[w, 0], [w, h]],
    [[w, h], [0, h]],
    [[0, h], [0, 0]],
  ];
  const hits: Pt[] = [];
  for (const [a, b] of edges) {
    const da = dot(sub(a, M), n);
    const db = dot(sub(b, M), n);
    if (Math.abs(da) < EPS && Math.abs(db) < EPS) continue;
    if (da * db > EPS) continue;
    const denom = da - db;
    if (Math.abs(denom) < EPS) continue;
    const t = da / denom;
    if (t < -EPS || t > 1 + EPS) continue;
    const p = lerp(a, b, Math.max(0, Math.min(1, t)));
    if (hits.every(h => Math.hypot(h[0] - p[0], h[1] - p[1]) > 0.5)) hits.push(p);
  }
  return hits;
}

function emptyGeom(): PeelGeometry {
  return {
    outgoingClip:  "none",
    holeClip:      "polygon(0px 0px, 0px 0px, 0px 0px)",
    flapClip:      "polygon(0px 0px, 0px 0px, 0px 0px)",
    flapTransform: "none",
    creaseX:       0,
    creaseY:       0,
    creaseLength:  0,
    boxW:          0,
    boxH:          0,
    pageShadeToX:  0,
    pageShadeToY:  0,
    flapShadeToX:  0,
    flapShadeToY:  0,
  };
}

export function peelGeometry(
  corner: PeelCorner,
  t: number,
  w: number,
  h: number,
  fold: FoldHalf = "full",
): PeelGeometry {
  const progress = Math.max(0, Math.min(1, t));
  if (w < 8 || h < 8 || progress <= 0.002) return emptyGeom();

  const C = CORNER[corner](w, h);
  const u = pullUnit(corner, progress);
  // Half folds must stop on the spine. The +8 single-page pad would land the verso ~8px off the gutter.
  const s = progress * sClear(C, u, foldVerts(w, h, fold), fold === "full" ? 8 : 0);
  if (s <= 0.5) return emptyGeom();

  const P: Pt = [C[0] + u[0] * s, C[1] + u[1] * s];
  const M: Pt = [(C[0] + P[0]) / 2, (C[1] + P[1]) / 2];
  const toC = sub(C, P);
  const dist = len(toC);
  if (dist < 1) return emptyGeom();
  const n: Pt = [toC[0] / dist, toC[1] / dist];

  const page = rectVerts(w, h);
  const remaining = clipHalfPlane(page, M, [-n[0], -n[1]]);
  const folded    = clipHalfPlane(page, M, n);
  const flap      = reflectPoly(folded, M, n);

  const nx = n[0];
  const ny = n[1];
  const nM = nx * M[0] + ny * M[1];
  const a  = 1 - 2 * nx * nx;
  const b  = -2 * nx * ny;
  const c  = -2 * nx * ny;
  const d  = 1 - 2 * ny * ny;
  const tx = 2 * nx * nM;
  const ty = 2 * ny * nM;

  const hits = creaseHits(M, n, w, h);
  let creaseX = M[0];
  let creaseY = M[1];
  let creaseLength = 0;
  if (hits.length >= 2) {
    const aHit = hits[0];
    const bHit = hits[1];
    creaseX = (aHit[0] + bHit[0]) / 2;
    creaseY = (aHit[1] + bHit[1]) / 2;
    creaseLength = Math.hypot(bHit[0] - aHit[0], bHit[1] - aHit[1]);
  }

  const toTip = len(sub(P, M));
  const pageLen = Math.max(28, Math.min(64, toTip * 0.55));
  return {
    outgoingClip:  remaining.length >= 3 ? poly(remaining) : "polygon(0px 0px, 0px 0px, 0px 0px)",
    holeClip:      poly(folded),
    flapClip:      poly(flap),
    flapTransform: `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`,
    creaseX,
    creaseY,
    creaseLength,
    boxW:          w,
    boxH:          h,
    pageShadeToX:  creaseX + n[0] * pageLen,
    pageShadeToY:  creaseY + n[1] * pageLen,
    flapShadeToX:  P[0],
    flapShadeToY:  P[1],
  };
}

/** Grab the edge the reader actually tapped: right for LTR next, left for RTL next. */
export function peelCorner(dir: 1 | -1, rtl: boolean): PeelCorner {
  const fromRight = rtl ? dir === -1 : dir === 1;
  return fromRight ? "br" : "bl";
}

export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - (1 - u) ** 3;
}

export function easeInOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
}

/** Hold crease lighting for the first quarter, then drop it while the leaf still covers the neighbor. */
export function spreadShade(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  if (u <= 0.25) return 1;
  if (u >= 0.5) return 0;
  const x = (u - 0.25) / 0.25;
  return 1 - x * x * (3 - 2 * x);
}
