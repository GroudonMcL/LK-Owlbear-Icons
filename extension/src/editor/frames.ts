// Procedural frames. Each style paints the band between two insets of the
// token shape, so every frame works with every shape at any resolution.

import { rgba, shade } from "./color";
import type { FrameStyle, ShapeId } from "./model";
import { samplePerimeter, shapePolygon, type Point } from "./shapes";

export type Ctx = CanvasRenderingContext2D;

export interface FrameGeometry {
  shape: ShapeId;
  /** Token half-size in pixels; the canvas origin is the token centre. */
  R: number;
  /** Band edges in pixels from the token edge. */
  outer: number;
  inner: number;
  color: string;
}

export function tracePolygon(ctx: Ctx, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function joinFor(shape: ShapeId): CanvasLineJoin {
  return shape === "square" || shape === "hexagon" || shape === "hexagonFlat" ? "miter" : "round";
}

/** Strokes a line centred at `inset` pixels from the edge, `width` pixels wide. */
function strokeAt(ctx: Ctx, g: FrameGeometry, inset: number, width: number, style: string | CanvasGradient): void {
  const poly = shapePolygon(g.shape, g.R, inset);
  if (poly.length === 0 || width <= 0) return;
  tracePolygon(ctx, poly);
  ctx.lineWidth = width;
  ctx.lineJoin = joinFor(g.shape);
  ctx.miterLimit = 4;
  ctx.strokeStyle = style;
  ctx.stroke();
}

function metalGradient(ctx: Ctx, R: number, color: string, contrast: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(-R * 0.6, -R, R * 0.6, R);
  gradient.addColorStop(0, shade(color, 0.55 * contrast));
  gradient.addColorStop(0.22, color);
  gradient.addColorStop(0.48, shade(color, -0.38 * contrast));
  gradient.addColorStop(0.7, shade(color, 0.25 * contrast));
  gradient.addColorStop(1, shade(color, -0.45 * contrast));
  return gradient;
}

/** Number of ornaments for an outline, keeping polygon vertices on ornaments. */
function ornamentCount(shape: ShapeId, approx: number): number {
  const sides = shape === "square" || shape === "rounded" ? 4 : shape === "circle" ? 1 : 6;
  return Math.max(sides, Math.round(approx / sides) * sides);
}

function drawLine(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  strokeAt(ctx, g, g.outer + w / 2, w, g.color);
}

function drawDouble(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  strokeAt(ctx, g, g.outer + w * 0.2, w * 0.4, g.color);
  strokeAt(ctx, g, g.outer + w * 0.86, w * 0.2, g.color);
  // Small diamonds bridging the two lines.
  const mid = shapePolygon(g.shape, g.R, g.outer + w * 0.6);
  const size = w * 0.24;
  ctx.fillStyle = g.color;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 8))) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(0, -size * 0.7);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawGilded(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  // Soft shadow cast onto the art.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = w * 0.6;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, g.color, 1));
  ctx.restore();
  // Bevel: bright outer lip, dark inner lip, a fine bright inner bead.
  strokeAt(ctx, g, g.outer + w * 0.06, w * 0.12, rgba(shade(g.color, 0.75), 0.9));
  strokeAt(ctx, g, g.inner - w * 0.08, w * 0.16, rgba(shade(g.color, -0.6), 0.85));
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.06, rgba(shade(g.color, 0.6), 0.55));
}

function drawEngraved(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = w * 0.5;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, shade(g.color, -0.15), 0.7));
  ctx.restore();
  // Engraved channel: a dark groove with a highlight beneath it.
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.16, rgba(shade(g.color, -0.75), 0.9));
  strokeAt(ctx, g, g.outer + w * 0.6, w * 0.05, rgba(shade(g.color, 0.5), 0.5));
  strokeAt(ctx, g, g.outer + w * 0.04, w * 0.08, rgba(shade(g.color, 0.55), 0.7));
  strokeAt(ctx, g, g.inner - w * 0.05, w * 0.1, rgba(shade(g.color, -0.7), 0.9));
  // Notches across the band.
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  ctx.strokeStyle = rgba(shade(g.color, -0.7), 0.85);
  ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.lineCap = "round";
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 36))) {
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    ctx.beginPath();
    ctx.moveTo(p.x - nx * w * 0.32, p.y - ny * w * 0.32);
    ctx.lineTo(p.x - nx * w * 0.12, p.y - ny * w * 0.12);
    ctx.stroke();
  }
}

function drawArcane(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  const glow = shade(g.color, 0.35);
  ctx.save();
  ctx.shadowColor = rgba(g.color, 0.95);
  ctx.shadowBlur = w * 1.6;
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.5, rgba(g.color, 0.9));
  ctx.restore();
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.22, glow);
  strokeAt(ctx, g, g.outer + w * 0.08, w * 0.1, rgba(glow, 0.7));
  strokeAt(ctx, g, g.inner - w * 0.06, w * 0.1, rgba(glow, 0.7));
  // Runes: small four-pointed stars riding the band.
  const mid = shapePolygon(g.shape, g.R, g.outer + w * 0.5);
  ctx.fillStyle = shade(g.color, 0.85);
  ctx.save();
  ctx.shadowColor = rgba(g.color, 1);
  ctx.shadowBlur = w * 0.9;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 12))) {
    const s = w * 0.62;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s);
    ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
    ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
    ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
    ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
    ctx.fill();
  }
  ctx.restore();
}

function drawRiveted(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = w * 0.5;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, g.color, 0.75));
  ctx.restore();
  strokeAt(ctx, g, g.outer + w * 0.05, w * 0.1, rgba(shade(g.color, 0.5), 0.6));
  strokeAt(ctx, g, g.inner - w * 0.05, w * 0.1, rgba(shade(g.color, -0.65), 0.9));
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  const r = w * 0.17;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 16))) {
    const gradient = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    gradient.addColorStop(0, shade(g.color, 0.75));
    gradient.addColorStop(0.55, shade(g.color, -0.1));
    gradient.addColorStop(1, shade(g.color, -0.6));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const PAINTERS: Record<Exclude<FrameStyle, "none">, (ctx: Ctx, g: FrameGeometry) => void> = {
  line: drawLine,
  double: drawDouble,
  gilded: drawGilded,
  engraved: drawEngraved,
  arcane: drawArcane,
  riveted: drawRiveted,
};

export function drawFrame(ctx: Ctx, style: FrameStyle, g: FrameGeometry): void {
  if (style === "none" || g.inner <= g.outer) return;
  ctx.save();
  PAINTERS[style](ctx, g);
  ctx.restore();
}
