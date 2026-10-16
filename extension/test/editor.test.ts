import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { applyAdjustments, removeFlatBackground } from "../src/editor/adjust";
import type { Ctx } from "../src/editor/frames";
import {
  clampTransform,
  computeInsets,
  fillTransform,
  fitTransform,
  imageClipPolygon,
  initialTransform,
  minZoomToCover,
  zoomAround,
} from "../src/editor/geometry";
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_STYLE,
  DEFAULT_TRANSFORM,
  FRAME_PRESETS,
  SHAPES,
  type ImageTransform,
  type ShapeId,
  type TokenStyle,
} from "../src/editor/model";
import { renderToken, type RenderSource } from "../src/editor/render";
import { boundingBox, pointInPolygon, samplePerimeter, shapePolygon } from "../src/editor/shapes";

function solidSource(width: number, height: number, color = "#ff0000"): RenderSource & { canvas: Canvas } {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return { canvas, image: canvas as unknown as CanvasImageSource, width, height };
}

function render(size: number, source: RenderSource | null, style: TokenStyle, transform: ImageTransform) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  renderToken(ctx as unknown as Ctx, size, source, style, transform);
  return { canvas, data: ctx.getImageData(0, 0, size, size).data, size };
}

const alphaAt = (img: { data: Uint8ClampedArray; size: number }, x: number, y: number) => img.data[(y * img.size + x) * 4 + 3];
const rgbAt = (img: { data: Uint8ClampedArray; size: number }, x: number, y: number) => {
  const i = (y * img.size + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

const bare: TokenStyle = { ...DEFAULT_STYLE, frame: "none", borderWidth: 0, margin: 0, padding: 0, backingOpacity: 0 };

describe("shapes", () => {
  it.each(SHAPES.map((s) => s.id))("%s fits the canvas and shrinks with inset", (shape) => {
    const outer = boundingBox(shapePolygon(shape, 1, 0));
    expect(outer.maxY).toBeCloseTo(shape === "hexagonFlat" ? Math.sqrt(3) / 2 : 1, 6);
    expect(outer.minY).toBeCloseTo(-outer.maxY, 6);
    const inner = boundingBox(shapePolygon(shape, 1, 0.1));
    expect(inner.maxY).toBeLessThan(outer.maxY);
    expect(shapePolygon(shape, 1, 2)).toEqual([]);
  });

  it("insets hexagons by perpendicular distance", () => {
    const outer = boundingBox(shapePolygon("hexagon", 1, 0));
    const inner = boundingBox(shapePolygon("hexagon", 1, 0.1));
    expect(outer.maxX - inner.maxX).toBeCloseTo(0.1, 6); // flat sides move by exactly the inset
  });

  it("samples a perimeter evenly", () => {
    const samples = samplePerimeter(shapePolygon("square", 1, 0), 8);
    expect(samples).toHaveLength(8);
    expect(samples[0]).toMatchObject({ x: -1, y: -1 });
    expect(samples[2].x).toBeCloseTo(1);
    expect(samples[2].y).toBeCloseTo(-1);
  });
});

describe("crop geometry", () => {
  const clip = imageClipPolygon(bare);

  it("needs zoom 1 to cover at 0° and more when rotated", () => {
    expect(minZoomToCover(400, 400, clip, 0)).toBeCloseTo(1, 3);
    expect(minZoomToCover(400, 400, shapePolygon("square", 1, 0), 45)).toBeCloseTo(Math.SQRT2, 3);
    // A circle needs no extra zoom when rotated.
    expect(minZoomToCover(400, 400, clip, 33)).toBeCloseTo(1, 2);
  });

  it("fit shows the whole image and unlocks fill", () => {
    const t = fitTransform(DEFAULT_TRANSFORM, 800, 200, clip);
    expect(t.lockFill).toBe(false);
    expect(t.zoom).toBeCloseTo(0.25, 3);
    expect(fillTransform(t, 800, 200, clip)).toMatchObject({ lockFill: true, zoom: expect.closeTo(1, 3) });
  });

  it("biases portraits towards the top", () => {
    expect(initialTransform(300, 600, clip).offsetY).toBeGreaterThan(0);
    expect(initialTransform(600, 300, clip).offsetY).toBe(0);
  });

  it("zooms around the pointer", () => {
    const t = zoomAround({ ...DEFAULT_TRANSFORM, zoom: 1 }, 2, { x: 0.5, y: 0 });
    expect(t).toMatchObject({ zoom: 2, offsetX: -0.5, offsetY: 0 });
  });

  // Property test: whatever the user does, a locked image covers the frame.
  const cases: [string, number, number, ShapeId, number][] = [
    ["portrait circle", 300, 900, "circle", 0],
    ["landscape hexagon", 1600, 400, "hexagon", 0],
    ["panorama square rotated", 2000, 200, "square", 30],
    ["square rounded rotated", 500, 500, "rounded", -60],
    ["flat hex rotated", 640, 480, "hexagonFlat", 15],
  ];
  it.each(cases)("%s: clamped transforms never expose empty frame area", (_name, w, h, shape, rotation) => {
    const style = { ...bare, shape };
    const poly = imageClipPolygon(style);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      const t = clampTransform(
        { ...DEFAULT_TRANSFORM, rotation, zoom: 0.2 + Math.abs(rand()) * 3, offsetX: rand() * 3, offsetY: rand() * 3 },
        w,
        h,
        poly,
      );
      // Every clip vertex, mapped into image pixel space, lies inside the image.
      const s = (Math.max(
        (boundingBox(poly).maxX - boundingBox(poly).minX) / w,
        (boundingBox(poly).maxY - boundingBox(poly).minY) / h,
      )) * t.zoom;
      const th = (-t.rotation * Math.PI) / 180;
      for (const v of poly) {
        const dx = v.x - t.offsetX;
        const dy = v.y - t.offsetY;
        const ix = (dx * Math.cos(th) - dy * Math.sin(th)) / s;
        const iy = (dx * Math.sin(th) + dy * Math.cos(th)) / s;
        expect(Math.abs(ix)).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(Math.abs(iy)).toBeLessThanOrEqual(h / 2 + 1e-6);
      }
    }
  });
});

describe("renderToken", () => {
  it.each(SHAPES.map((s) => s.id))("%s: transparent outside the shape, opaque inside", (shape) => {
    const img = render(256, solidSource(300, 400), { ...bare, shape }, DEFAULT_TRANSFORM);
    expect(alphaAt(img, 128, 128)).toBe(255);
    expect(rgbAt(img, 128, 128)).toEqual([255, 0, 0]);
    const poly = shapePolygon(shape, 128, 0).map((p) => ({ x: p.x + 128, y: p.y + 128 }));
    for (const [x, y] of [[1, 1], [254, 1], [1, 254], [254, 254], [128, 1], [1, 128]]) {
      const inside = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, poly);
      if (!inside) expect(alphaAt(img, x, y)).toBe(0);
    }
    // Square fills the corners.
    if (shape === "square") expect(alphaAt(img, 1, 1)).toBe(255);
  });

  it("locked crops leave no transparent pixels inside the frame, for any drag", () => {
    for (const [w, h] of [[300, 900], [1600, 400]]) {
      const source = solidSource(w, h);
      const style = { ...bare, shape: "circle" as ShapeId };
      const t = clampTransform({ ...DEFAULT_TRANSFORM, offsetX: 5, offsetY: -5, zoom: 0.1 }, w, h, imageClipPolygon(style));
      const img = render(200, source, style, t);
      const inner = shapePolygon("circle", 100, 2).map((p) => ({ x: p.x + 100, y: p.y + 100 }));
      for (let y = 0; y < 200; y += 3) {
        for (let x = 0; x < 200; x += 3) {
          if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, inner)) expect(alphaAt(img, x, y)).toBe(255);
        }
      }
    }
  });

  it("export matches preview: the same render at two resolutions agrees", () => {
    const art = createCanvas(320, 480);
    const actx = art.getContext("2d");
    const g = actx.createLinearGradient(0, 0, 320, 480);
    g.addColorStop(0, "#1b4d89");
    g.addColorStop(1, "#e3b341");
    actx.fillStyle = g;
    actx.fillRect(0, 0, 320, 480);
    actx.fillStyle = "#fff";
    actx.fillRect(100, 80, 120, 160);
    const source = { image: art as unknown as CanvasImageSource, width: 320, height: 480 };
    const style: TokenStyle = { ...DEFAULT_STYLE, shape: "hexagon", padding: 0.04 };
    const t: ImageTransform = { ...DEFAULT_TRANSFORM, zoom: 1.4, offsetX: 0.1, offsetY: 0.2, rotation: 12, flipX: true };

    const preview = render(128, source, style, t);
    const exported = render(512, source, style, t);
    const down = createCanvas(128, 128);
    const dctx = down.getContext("2d");
    dctx.drawImage(exported.canvas, 0, 0, 128, 128);
    const d = dctx.getImageData(0, 0, 128, 128).data;
    let diff = 0;
    for (let i = 0; i < d.length; i++) diff += Math.abs(d[i] - preview.data[i]);
    const meanDiff = diff / d.length;
    expect(meanDiff).toBeLessThan(6); // resampling noise only
  });

  it.each(FRAME_PRESETS.map((p) => p.id))("frame preset %s renders inside the canvas", (id) => {
    const preset = FRAME_PRESETS.find((p) => p.id === id)!;
    for (const shape of SHAPES.map((s) => s.id)) {
      const style: TokenStyle = { ...DEFAULT_STYLE, ...preset.style, shape };
      const img = render(128, solidSource(100, 100, "#335533"), style, DEFAULT_TRANSFORM);
      expect(alphaAt(img, 64, 64)).toBe(255);
      if (shape === "circle") expect(alphaAt(img, 0, 0)).toBe(0); // corners stay transparent
    }
  });

  it("paints padding with the backing colour and leaves the outside clear", () => {
    const style: TokenStyle = { ...DEFAULT_STYLE, frame: "line", borderWidth: 0.05, margin: 0, padding: 0.15, backingColor: "#00ff00", backingOpacity: 1 };
    const img = render(200, solidSource(100, 100), style, DEFAULT_TRANSFORM);
    const insets = computeInsets(style);
    const y = Math.round(100 * (insets.frameInner + style.padding / 2)); // depth from the top edge
    expect(rgbAt(img, 100, y)).toEqual([0, 255, 0]);
    expect(rgbAt(img, 100, 100)).toEqual([255, 0, 0]);
  });

  it("renders a frame-only token when there is no image", () => {
    const img = render(64, null, DEFAULT_STYLE, DEFAULT_TRANSFORM);
    expect(alphaAt(img, 32, 32)).toBe(255); // backing
  });
});

describe("adjustments", () => {
  const buffer = (pixels: number[][], width: number) => ({
    data: new Uint8ClampedArray(pixels.flat()),
    width,
    height: pixels.length / width,
  });

  it("brightens and leaves alpha alone", () => {
    const b = buffer([[100, 100, 100, 200]], 1);
    applyAdjustments(b, { ...DEFAULT_ADJUSTMENTS, brightness: 50 });
    expect(b.data[0]).toBeGreaterThan(100);
    expect(b.data[3]).toBe(200);
  });

  it("desaturates to grey", () => {
    const b = buffer([[200, 50, 50, 255]], 1);
    applyAdjustments(b, { ...DEFAULT_ADJUSTMENTS, saturation: -100 });
    expect(b.data[0]).toBe(b.data[1]);
    expect(b.data[1]).toBe(b.data[2]);
  });

  it("removes an edge-connected flat background but keeps enclosed areas", () => {
    // 5×5 white field, red ring, white centre enclosed by the ring.
    const W = [255, 255, 255, 255];
    const R = [200, 0, 0, 255];
    const rows = [
      [W, W, W, W, W],
      [W, R, R, R, W],
      [W, R, W, R, W],
      [W, R, R, R, W],
      [W, W, W, W, W],
    ];
    const b = buffer(rows.flat(), 5);
    const removed = removeFlatBackground(b, 10);
    expect(removed).toBe(16);
    const alpha = (x: number, y: number) => b.data[(y * 5 + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(2, 2)).toBe(255); // enclosed white survives
    expect(alpha(1, 1)).toBe(255); // subject untouched
  });
});
