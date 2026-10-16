// The one renderer. The live preview and the exported PNG both come from
// renderToken with the same settings; only the pixel size differs.

import { parseHex } from "./color";
import { drawFrame, tracePolygon, type Ctx } from "./frames";
import { baseScale, computeInsets } from "./geometry";
import type { ImageTransform, TokenStyle } from "./model";
import { shapePolygon } from "./shapes";

export interface RenderSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** Paints a token into a `size`×`size` area starting at the context's origin. */
export function renderToken(
  ctx: Ctx,
  size: number,
  source: RenderSource | null,
  style: TokenStyle,
  transform: ImageTransform,
): void {
  const R = size / 2;
  const insets = computeInsets(style);

  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(R, R);

  // Backing: shows through padding, transparent art and letterboxed fits.
  const backing = shapePolygon(style.shape, R, insets.backing * R);
  if (style.backingOpacity > 0 && backing.length) {
    const { r, g, b } = parseHex(style.backingColor);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, style.backingOpacity)})`;
    tracePolygon(ctx, backing);
    ctx.fill();
  }

  const clip = shapePolygon(style.shape, R, insets.image * R);
  if (source && clip.length) {
    ctx.save();
    tracePolygon(ctx, clip);
    ctx.clip();
    // Scale is computed for a unit token, then applied in pixels.
    const unitClip = clip.map((p) => ({ x: p.x / R, y: p.y / R }));
    const s = baseScale(source.width, source.height, unitClip) * transform.zoom * R;
    ctx.translate(transform.offsetX * R, transform.offsetY * R);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.flipX ? -s : s, s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.image, -source.width / 2, -source.height / 2, source.width, source.height);
    ctx.restore();
  }

  ctx.globalAlpha = Math.min(1, Math.max(0, style.frameOpacity));
  drawFrame(ctx, style.frame, {
    shape: style.shape,
    R,
    outer: insets.frameOuter * R,
    inner: insets.frameInner * R,
    color: style.frameColor,
  });
  ctx.restore();
}
