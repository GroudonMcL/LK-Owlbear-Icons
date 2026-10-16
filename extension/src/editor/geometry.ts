// Crop maths: where the image sits inside the frame, how far it may move and
// how small it may get before an empty corner would show.

import { DEFAULT_TRANSFORM, ZOOM_MAX, type ImageTransform, type TokenStyle } from "./model";
import { boundingBox, shapePolygon, type Point } from "./shapes";

export interface Insets {
  /** Outer edge of the frame band. */
  frameOuter: number;
  /** Inner edge of the frame band. */
  frameInner: number;
  /** Where the backing is painted from. */
  backing: number;
  /** Where the image is clipped. */
  image: number;
}

/** Insets in units of R. With no padding the image runs under half the border to avoid a seam. */
export function computeInsets(style: TokenStyle): Insets {
  const border = style.frame === "none" ? 0 : style.borderWidth;
  const frameOuter = style.margin;
  const frameInner = style.margin + border;
  return {
    frameOuter,
    frameInner,
    backing: frameOuter + border / 2,
    image: style.padding > 0 ? frameInner + style.padding : frameOuter + border / 2,
  };
}

/** The polygon the image must cover, for a token of half-size 1. */
export function imageClipPolygon(style: TokenStyle): Point[] {
  return shapePolygon(style.shape, 1, computeInsets(style).image);
}

/** Scale (image px → R units) at which the image exactly covers the clip region's bounding box. */
export function baseScale(imageWidth: number, imageHeight: number, clip: Point[]): number {
  const box = boundingBox(clip);
  return Math.max((box.maxX - box.minX) / imageWidth, (box.maxY - box.minY) / imageHeight);
}

function rotate(p: Point, radians: number): Point {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Clip polygon in the image's rotated frame (rotated by -θ). */
function rotatedExtents(clip: Point[], rotationDeg: number) {
  return boundingBox(clip.map((p) => rotate(p, (-rotationDeg * Math.PI) / 180)));
}

/** The smallest zoom at which the rotated image still covers the clip polygon. */
export function minZoomToCover(imageWidth: number, imageHeight: number, clip: Point[], rotationDeg: number): number {
  const s0 = baseScale(imageWidth, imageHeight, clip);
  const e = rotatedExtents(clip, rotationDeg);
  return Math.max((e.maxX - e.minX) / (imageWidth * s0), (e.maxY - e.minY) / (imageHeight * s0));
}

/** Zoom at which the whole image is visible inside the clip region's bounding box (letterboxed). */
export function fitZoom(imageWidth: number, imageHeight: number, clip: Point[]): number {
  const box = boundingBox(clip);
  const contain = Math.min((box.maxX - box.minX) / imageWidth, (box.maxY - box.minY) / imageHeight);
  return contain / baseScale(imageWidth, imageHeight, clip);
}

/**
 * Pulls zoom and offset back to the nearest values at which the image covers
 * the clip polygon. The polygon lies inside the rotated image rectangle exactly
 * when every vertex does, which in the image's own frame is a box constraint
 * on the centre offset.
 */
export function clampTransform(
  t: ImageTransform,
  imageWidth: number,
  imageHeight: number,
  clip: Point[],
): ImageTransform {
  const lower = t.lockFill ? minZoomToCover(imageWidth, imageHeight, clip, t.rotation) : 0.05;
  const zoom = Math.min(ZOOM_MAX, Math.max(lower, Number.isFinite(t.zoom) ? t.zoom : 1));
  if (!t.lockFill) return { ...t, zoom };

  const theta = (t.rotation * Math.PI) / 180;
  const s = baseScale(imageWidth, imageHeight, clip) * zoom;
  const halfW = (imageWidth * s) / 2;
  const halfH = (imageHeight * s) / 2;
  const e = rotatedExtents(clip, t.rotation);
  const u = rotate({ x: t.offsetX, y: t.offsetY }, -theta);
  const clampAxis = (value: number, max: number, min: number, half: number) => {
    const lo = max - half;
    const hi = min + half;
    return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value));
  };
  const clamped = rotate(
    { x: clampAxis(u.x, e.maxX, e.minX, halfW), y: clampAxis(u.y, e.maxY, e.minY, halfH) },
    theta,
  );
  return { ...t, zoom, offsetX: clamped.x, offsetY: clamped.y };
}

/** Zooms by `factor` keeping the image point under `anchor` (R units from centre) fixed. */
export function zoomAround(t: ImageTransform, factor: number, anchor: Point): ImageTransform {
  const zoom = t.zoom * factor;
  const ratio = zoom / t.zoom;
  return {
    ...t,
    zoom,
    offsetX: anchor.x - (anchor.x - t.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - t.offsetY) * ratio,
  };
}

export function fillTransform(t: ImageTransform, w: number, h: number, clip: Point[]): ImageTransform {
  return clampTransform({ ...t, lockFill: true, zoom: minZoomToCover(w, h, clip, t.rotation) }, w, h, clip);
}

export function fitTransform(t: ImageTransform, w: number, h: number, clip: Point[]): ImageTransform {
  return { ...t, lockFill: false, rotation: 0, zoom: fitZoom(w, h, clip), offsetX: 0, offsetY: 0 };
}

export function resetTransform(w: number, h: number, clip: Point[]): ImageTransform {
  return clampTransform({ ...DEFAULT_TRANSFORM }, w, h, clip);
}

/**
 * Initial framing: fill the frame and bias portrait art upwards, where faces
 * usually are.
 */
export function initialTransform(w: number, h: number, clip: Point[]): ImageTransform {
  const base = resetTransform(w, h, clip);
  if (h <= w * 1.15) return base;
  const topAligned = clampTransform({ ...base, offsetY: 10 }, w, h, clip);
  return { ...base, offsetY: topAligned.offsetY * 0.6 };
}
