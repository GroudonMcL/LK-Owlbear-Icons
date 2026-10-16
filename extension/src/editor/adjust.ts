// Pixel adjustments, applied once to the working copy of the image whenever a
// slider settles rather than on every preview frame. Pure ImageData maths, so
// they behave the same in every browser (canvas `filter` is missing in Safari).

import type { ImageAdjustments } from "./model";

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function hasAdjustments(a: ImageAdjustments): boolean {
  return a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || a.removeBackground;
}

/** Applies adjustments in place. Background removal runs first, on the original colours. */
export function applyAdjustments(buffer: PixelBuffer, a: ImageAdjustments): void {
  if (a.removeBackground) removeFlatBackground(buffer, a.backgroundTolerance);
  if (a.brightness === 0 && a.contrast === 0 && a.saturation === 0) return;

  const brightness = (a.brightness / 100) * 255 * 0.5;
  const c = (a.contrast / 100) * 255 * 0.9;
  const contrast = (259 * (c + 255)) / (255 * (259 - c));
  const saturation = 1 + a.saturation / 100;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = contrast * (v + brightness - 128) + 128;

  const d = buffer.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (saturation !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
    }
    d[i] = lut[Math.min(255, Math.max(0, Math.round(r)))];
    d[i + 1] = lut[Math.min(255, Math.max(0, Math.round(g)))];
    d[i + 2] = lut[Math.min(255, Math.max(0, Math.round(b)))];
  }
}

function distance(d: Uint8ClampedArray, i: number, ref: [number, number, number]): number {
  return Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]);
}

/**
 * Makes a flat background transparent by flood-filling from the image edges
 * through pixels close to the dominant corner colour. Interior areas of the
 * same colour that are not connected to the edge are kept. Edge pixels get a
 * soft falloff so the cut-out does not look jagged.
 */
export function removeFlatBackground(buffer: PixelBuffer, tolerance: number): number {
  const { data: d, width: w, height: h } = buffer;
  if (w === 0 || h === 0) return 0;
  const threshold = Math.max(1, (tolerance / 100) * 180);
  const soft = threshold * 1.6;

  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4);
  const colors = corners.map((i) => [d[i], d[i + 1], d[i + 2]] as [number, number, number]);
  // The corner colour most other corners agree with.
  let ref = colors[0];
  let bestVotes = -1;
  for (const candidate of colors) {
    const votes = colors.filter((c) => Math.hypot(c[0] - candidate[0], c[1] - candidate[1], c[2] - candidate[2]) <= threshold).length;
    if (votes > bestVotes) {
      bestVotes = votes;
      ref = candidate;
    }
  }

  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!visited[p] && d[p * 4 + 3] > 0 && distance(d, p * 4, ref) <= threshold) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }

  let removed = 0;
  while (stack.length) {
    const p = stack.pop()!;
    d[p * 4 + 3] = 0;
    removed++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }

  // Feather: pixels bordering the removed area fade according to similarity.
  for (let p = 0; p < w * h; p++) {
    if (visited[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const touches = (x > 0 && visited[p - 1]) || (x < w - 1 && visited[p + 1]) || (y > 0 && visited[p - w]) || (y < h - 1 && visited[p + w]);
    if (!touches) continue;
    const dist = distance(d, p * 4, ref);
    if (dist < soft) {
      const keep = (dist - threshold) / (soft - threshold);
      d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.min(1, Math.max(0.15, keep)));
    }
  }
  return removed;
}
