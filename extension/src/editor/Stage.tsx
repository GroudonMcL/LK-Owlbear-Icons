import { FlipHorizontal2, Lock, LockOpen, Maximize, Minimize, RotateCcw, RotateCw, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { cx, IconButton } from "../ui/components";
import { baseScale, clampTransform, fillTransform, fitTransform, minZoomToCover, resetTransform, zoomAround } from "./geometry";
import { ZOOM_MAX, type ImageTransform, type TokenStyle } from "./model";
import { renderToken, type RenderSource } from "./render";
import type { Point } from "./shapes";

const STAGE_PADDING = 56;
const MIN_TOKEN_CSS = 180;
const MAX_TOKEN_CSS = 620;

/** Draws the full image, dimmed, so the user sees what lies outside the frame. */
function drawContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  R: number,
  source: RenderSource,
  t: ImageTransform,
  unitClip: Point[],
): void {
  ctx.clearRect(0, 0, width, height);
  const s = baseScale(source.width, source.height, unitClip) * t.zoom * R;
  ctx.save();
  ctx.translate(width / 2 + t.offsetX * R, height / 2 + t.offsetY * R);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.flipX ? -s : s, s);
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(source.image, -source.width / 2, -source.height / 2);
  ctx.restore();
}

export function Stage({
  source,
  style,
  transform,
  clip,
  onChange,
  overlay,
}: {
  source: RenderSource | null;
  style: TokenStyle;
  transform: ImageTransform;
  /** Image clip polygon for a unit token. */
  clip: Point[];
  onChange: (t: ImageTransform) => void;
  overlay?: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLCanvasElement>(null);
  const tokenRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ transform: ImageTransform; distance: number; x: number; y: number } | null>(null);
  const latest = useRef(transform);
  latest.current = transform;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tokenCss = Math.round(
    Math.max(MIN_TOKEN_CSS, Math.min(MAX_TOKEN_CSS, Math.min(box.width, box.height - 60) - STAGE_PADDING * 2)),
  );
  const R = tokenCss / 2;

  // Draw both layers on the next frame whenever anything visual changes.
  useEffect(() => {
    if (!box.width || !box.height) return;
    const frame = requestAnimationFrame(() => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const token = tokenRef.current;
      if (token) {
        const px = Math.round(tokenCss * dpr);
        if (token.width !== px) {
          token.width = px;
          token.height = px;
        }
        renderToken(token.getContext("2d")!, px, source, style, transform);
      }
      const context = contextRef.current;
      if (context) {
        const w = Math.round(box.width * dpr);
        const h = Math.round(box.height * dpr);
        if (context.width !== w || context.height !== h) {
          context.width = w;
          context.height = h;
        }
        const ctx = context.getContext("2d")!;
        if (source) drawContext(ctx, w, h, R * dpr, source, transform, clip);
        else ctx.clearRect(0, 0, w, h);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [box, tokenCss, R, source, style, transform, clip]);

  const apply = (t: ImageTransform) => {
    if (!source) return;
    onChange(clampTransform(t, source.width, source.height, clip));
  };

  /** Pointer position relative to the token centre, in units of R. */
  const toUnits = (clientX: number, clientY: number): Point => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - rect.width / 2) / R, y: (clientY - rect.top - rect.height / 2) / R };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!source || (e.target as HTMLElement).closest(".toolbar")) return;
    stageRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);
    setTouched(true);
    startGesture();
  };

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const distance = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { transform: latest.current, distance, x: cx, y: cy };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const g = gesture.current;
    let next: ImageTransform = {
      ...g.transform,
      offsetX: g.transform.offsetX + (cx - g.x) / R,
      offsetY: g.transform.offsetY + (cy - g.y) / R,
    };
    if (pts.length > 1 && g.distance > 0) {
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      next = zoomAround(next, distance / g.distance, toUnits(cx, cy));
    }
    apply(next);
  };

  const endPointer = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      setDragging(false);
      gesture.current = null;
    } else {
      startGesture();
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!source) return;
    setTouched(true);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    apply(zoomAround(latest.current, factor, toUnits(e.clientX, e.clientY)));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!source) return;
    const step = e.shiftKey ? 0.08 : 0.015;
    const t = latest.current;
    const moves: Record<string, Partial<ImageTransform>> = {
      ArrowLeft: { offsetX: t.offsetX - step },
      ArrowRight: { offsetX: t.offsetX + step },
      ArrowUp: { offsetY: t.offsetY - step },
      ArrowDown: { offsetY: t.offsetY + step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      apply({ ...t, ...moves[e.key] });
    } else if (e.key === "+" || e.key === "=") {
      apply(zoomAround(t, 1.1, { x: 0, y: 0 }));
    } else if (e.key === "-") {
      apply(zoomAround(t, 1 / 1.1, { x: 0, y: 0 }));
    } else if (e.key === "0") {
      onChange(resetTransform(source.width, source.height, clip));
    }
  };

  const minZoom = source && transform.lockFill ? minZoomToCover(source.width, source.height, clip, transform.rotation) : 0.1;
  // The slider works on a log scale so small zooms are as easy to dial as large ones.
  const toSlider = (z: number) => Math.log(z);
  const fromSlider = (v: number) => Math.exp(v);
  const rotateBy = (deg: number) => apply({ ...transform, rotation: ((((transform.rotation + deg + 180) % 360) + 360) % 360) - 180 });

  return (
    <div
      ref={stageRef}
      className={cx("stage", dragging && "dragging")}
      tabIndex={0}
      aria-label="Token preview. Drag to move the image, scroll to zoom, arrow keys to nudge."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onDoubleClick={() => source && onChange(fillTransform(transform, source.width, source.height, clip))}
    >
      <canvas ref={contextRef} className="context-layer" style={{ opacity: dragging ? 0.42 : 0.2 }} />
      <canvas
        ref={tokenRef}
        className="token-layer"
        style={{ width: tokenCss, height: tokenCss, left: `calc(50% - ${R}px)`, top: `calc(50% - ${R}px)` }}
      />
      {source && (
        <div className={cx("stage-hint", touched && "hidden")}>
          Drag to move · Scroll to zoom · Double-click to fill
        </div>
      )}
      {overlay && <div className="stage-status">{overlay}</div>}

      {source && (
        <div className="toolbar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <IconButton label="Zoom out" onClick={() => apply(zoomAround(transform, 1 / 1.15, { x: 0, y: 0 }))}>
            <ZoomOut />
          </IconButton>
          <input
            type="range"
            aria-label="Zoom"
            min={toSlider(Math.max(0.05, Math.min(minZoom, 1)))}
            max={toSlider(ZOOM_MAX)}
            step={0.01}
            value={toSlider(transform.zoom)}
            style={{
              ["--fill" as string]: `${((toSlider(transform.zoom) - toSlider(Math.min(minZoom, 1))) / (toSlider(ZOOM_MAX) - toSlider(Math.min(minZoom, 1)))) * 100}%`,
            }}
            onChange={(e) => apply(zoomAround(transform, fromSlider(Number(e.target.value)) / transform.zoom, { x: 0, y: 0 }))}
          />
          <IconButton label="Zoom in" onClick={() => apply(zoomAround(transform, 1.15, { x: 0, y: 0 }))}>
            <ZoomIn />
          </IconButton>
          <span className="zoom-readout">{Math.round(transform.zoom * 100)}%</span>
          <span className="sep" />
          <IconButton className="hide-narrow" label="Rotate left 90°" onClick={() => rotateBy(-90)}>
            <RotateCcw />
          </IconButton>
          <IconButton className="hide-narrow" label="Rotate right 90°" onClick={() => rotateBy(90)}>
            <RotateCw />
          </IconButton>
          <IconButton label="Flip horizontally" pressed={transform.flipX} onClick={() => apply({ ...transform, flipX: !transform.flipX })}>
            <FlipHorizontal2 />
          </IconButton>
          <span className="sep" />
          <IconButton label="Fill frame" onClick={() => onChange(fillTransform(transform, source.width, source.height, clip))}>
            <Maximize />
          </IconButton>
          <IconButton label="Fit whole image" onClick={() => onChange(fitTransform(transform, source.width, source.height, clip))}>
            <Minimize />
          </IconButton>
          <IconButton
            label={transform.lockFill ? "Image locked to fill the frame (click to unlock)" : "Image free to move past the frame (click to lock)"}
            pressed={transform.lockFill}
            onClick={() => apply({ ...transform, lockFill: !transform.lockFill })}
          >
            {transform.lockFill ? <Lock /> : <LockOpen />}
          </IconButton>
          <IconButton label="Reset crop" onClick={() => onChange(resetTransform(source.width, source.height, clip))}>
            <Undo2 />
          </IconButton>
        </div>
      )}
    </div>
  );
}
