// Token shapes as polygons centred on the origin. Curves are sampled finely
// enough (< 0.1 px error at 1024 px) that polygons serve for drawing, clipping,
// coverage maths and placing frame ornaments alike.

import type { ShapeId } from "./model";

export interface Point {
  x: number;
  y: number;
}

const CIRCLE_SEGMENTS = 180;
const CORNER_SEGMENTS = 16;
/** Rounded square corner radius as a fraction of the outer half-size. */
export const ROUNDED_CORNER = 0.24;
const SQRT3 = Math.sqrt(3);

/**
 * The outline of `shape` for a token of half-size `R`, moved inwards by
 * `inset` (a true parallel offset). Vertices start at the top and run
 * clockwise. Returns an empty array when the inset swallows the shape.
 */
export function shapePolygon(shape: ShapeId, R: number, inset: number): Point[] {
  switch (shape) {
    case "circle": {
      const r = R - inset;
      if (r <= 0) return [];
      return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
        const a = -Math.PI / 2 + (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
    }
    case "square": {
      const h = R - inset;
      if (h <= 0) return [];
      return [
        { x: -h, y: -h },
        { x: h, y: -h },
        { x: h, y: h },
        { x: -h, y: h },
      ];
    }
    case "rounded": {
      const h = R - inset;
      if (h <= 0) return [];
      const cr = Math.max(0, Math.min(h, R * ROUNDED_CORNER - inset));
      if (cr === 0) return shapePolygon("square", R, inset);
      const corners: [number, number, number][] = [
        [h - cr, -h + cr, -Math.PI / 2], // top-right
        [h - cr, h - cr, 0], // bottom-right
        [-h + cr, h - cr, Math.PI / 2], // bottom-left
        [-h + cr, -h + cr, Math.PI], // top-left
      ];
      const pts: Point[] = [];
      for (const [cx, cy, start] of corners) {
        for (let i = 0; i <= CORNER_SEGMENTS; i++) {
          const a = start + (i / CORNER_SEGMENTS) * (Math.PI / 2);
          pts.push({ x: cx + cr * Math.cos(a), y: cy + cr * Math.sin(a) });
        }
      }
      // Rotate so the outline starts at the top-left end of the top edge.
      const start = pts.splice(pts.length - CORNER_SEGMENTS - 1);
      return [...start, ...pts];
    }
    case "hexagon":
    case "hexagonFlat": {
      // Outer hexagon touches the canvas edge at its vertices.
      const apothem = (R * SQRT3) / 2 - inset;
      if (apothem <= 0) return [];
      const circumradius = (apothem * 2) / SQRT3;
      const offset = shape === "hexagon" ? -Math.PI / 2 : Math.PI;
      return Array.from({ length: 6 }, (_, i) => {
        const a = offset + (i * Math.PI) / 3;
        return { x: circumradius * Math.cos(a), y: circumradius * Math.sin(a) };
      });
    }
  }
}

export function boundingBox(points: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

export interface PerimeterSample extends Point {
  /** Direction of travel along the outline, radians. */
  angle: number;
}

/** `count` points evenly spaced by arc length along a closed polygon, starting at its first vertex. */
export function samplePerimeter(points: Point[], count: number): PerimeterSample[] {
  if (points.length < 2 || count <= 0) return [];
  const edges = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return { p, q, length: Math.hypot(q.x - p.x, q.y - p.y) };
  });
  const total = edges.reduce((sum, e) => sum + e.length, 0);
  const samples: PerimeterSample[] = [];
  let edgeIndex = 0;
  let walked = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (edgeIndex < edges.length - 1 && walked + edges[edgeIndex].length < target - 1e-9) {
      walked += edges[edgeIndex].length;
      edgeIndex++;
    }
    const { p, q, length } = edges[edgeIndex];
    const t = length === 0 ? 0 : (target - walked) / length;
    samples.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, angle: Math.atan2(q.y - p.y, q.x - p.x) });
  }
  return samples;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(pt: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
