// Decodes a source image into a bounded working copy. Large campaign art is
// downscaled once, so dragging and zooming never touch a 6000 px bitmap.

import { applyAdjustments, hasAdjustments } from "./adjust";
import type { ImageAdjustments } from "./model";
import type { RenderSource } from "./render";

/** Longest side of the working copy. 2048 leaves headroom for zooming into a 1024 px export. */
export const WORKING_MAX_SIDE = 2048;
/** Refuse to decode absurd images (e.g. 20k × 20k) that would exhaust memory. */
const MAX_SOURCE_PIXELS = 80_000_000;

export class ImageDecodeError extends Error {}

export interface WorkingImage extends RenderSource {
  image: HTMLCanvasElement;
  /** Size of the original before downscaling. */
  originalWidth: number;
  originalHeight: number;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function decodeWorkingImage(blob: Blob): Promise<WorkingImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new ImageDecodeError("This image could not be decoded by your browser.");
  }
  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) throw new ImageDecodeError("This image is empty.");
    if (width * height > MAX_SOURCE_PIXELS) throw new ImageDecodeError("This image is too large to edit.");
    const scale = Math.min(1, WORKING_MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    return { image: canvas, width: w, height: h, originalWidth: width, originalHeight: height };
  } finally {
    bitmap.close();
  }
}

/** A copy of the working image with adjustments applied; the original is untouched. */
export function adjustedCopy(source: WorkingImage, adjustments: ImageAdjustments): WorkingImage {
  if (!hasAdjustments(adjustments)) return source;
  const canvas = makeCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source.image, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height);
  applyAdjustments(pixels, adjustments);
  ctx.putImageData(pixels, 0, 0);
  return { ...source, image: canvas };
}

/** Releases a working canvas's backing store early instead of waiting for GC. */
export function releaseWorkingImage(image: WorkingImage | null | undefined): void {
  if (!image) return;
  image.image.width = 0;
  image.image.height = 0;
}
