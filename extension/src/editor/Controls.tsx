import { SIZE_CATEGORIES, SIZE_LABELS, type DetectedSize, type PageImage, type SizeCategory } from "@lkti/shared";
import { ChevronRight, Crop, Frame, ImageIcon, Info, Paintbrush, Settings2, UserRound } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ApiClient } from "../lib/api";
import type { Placement, TokenHosting } from "../lib/settings";
import { Field, Segmented, Slider } from "../ui/components";
import { useAuthedImage } from "../ui/useAuthedImage";
import { isValidHex } from "./color";
import {
  FRAME_PRESETS,
  SHAPES,
  type ExportSize,
  type FramePreset,
  type ImageAdjustments,
  type ImageTransform,
  type ShapeId,
  type TokenStyle,
} from "./model";
import { renderToken, type RenderSource } from "./render";
import { shapePolygon } from "./shapes";

export function Section({
  icon,
  title,
  note,
  open,
  children,
}: {
  icon: ReactNode;
  title: string;
  note?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        {icon}
        {title}
        {note && <span className="summary-note">{note}</span>}
        <ChevronRight className="chev" aria-hidden style={note ? { marginLeft: 6 } : { marginLeft: "auto" }} />
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function ShapeGlyph({ shape }: { shape: ShapeId }) {
  const points = shapePolygon(shape, 9, 0.6)
    .map((p) => `${(p.x + 10).toFixed(2)},${(p.y + 10).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <polygon points={points} fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** A frame preset rendered with the user's own image, shape and crop. */
function PresetPreview({ preset, style, source, transform }: { preset: FramePreset; style: TokenStyle; source: RenderSource | null; transform: ImageTransform }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const px = Math.round(56 * Math.min(2, window.devicePixelRatio || 1));
      canvas.width = px;
      canvas.height = px;
      renderToken(canvas.getContext("2d")!, px, source, { ...style, ...preset.style }, transform);
    }, 90);
    return () => clearTimeout(t);
  }, [preset, style, source, transform]);
  return <canvas ref={ref} aria-hidden />;
}

const FRAME_COLORS = ["#d4a64a", "#b8c2cf", "#9a6a3c", "#7a7f8a", "#f4f1ea", "#1c1c22", "#6fc3ff", "#ff6a3d", "#8fd27a", "#b48ef0", "#d9534f"];
const BACKING_COLORS = ["#1d1f27", "#3b2f2a", "#24324a", "#2f3a2b", "#efe6d2", "#ffffff"];

function ColorPicker({
  label,
  value,
  colors,
  onChange,
  allowTransparent,
  transparent,
  onTransparent,
}: {
  label: string;
  value: string;
  colors: string[];
  onChange: (hex: string) => void;
  allowTransparent?: boolean;
  transparent?: boolean;
  onTransparent?: () => void;
}) {
  const custom = !colors.includes(value.toLowerCase());
  return (
    <Field label={label}>
      <div className="swatches" role="group" aria-label={label}>
        {allowTransparent && (
          <button type="button" className="swatch transparent" aria-pressed={transparent} title="Transparent" aria-label="Transparent" onClick={onTransparent} />
        )}
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            aria-pressed={!transparent && value.toLowerCase() === c}
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="swatch custom" title="Custom colour" aria-pressed={!transparent && custom}>
          <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={isValidHex(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </Field>
  );
}

function StripThumb({ api, projectId, resourceId, image, selected, onSelect }: { api: ApiClient; projectId: string; resourceId: string; image: PageImage; selected: boolean; onSelect: () => void }) {
  const state = useAuthedImage(api, projectId, resourceId, image.id);
  return (
    <button type="button" className="strip-thumb" aria-pressed={selected} title={image.label} aria-label={image.label} onClick={onSelect} disabled={state.status === "error"}>
      {state.status === "ready" ? <img src={state.url} alt="" /> : <span className="skeleton" style={{ display: "block", width: "100%", height: "100%" }} />}
    </button>
  );
}

function FootprintGrid({ cells }: { cells: number }) {
  const n = Math.max(1, Math.min(6, Math.ceil(cells)));
  const fraction = cells < 1;
  return (
    <div className="footprint-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden>
      {Array.from({ length: n * n }, (_, i) => (
        <span key={i} className={fraction ? undefined : "on"} style={fraction && i === 0 ? { background: "var(--accent)", transform: `scale(${cells})`, transformOrigin: "center" } : undefined} />
      ))}
    </div>
  );
}

const SHORT_SIZE: Record<SizeCategory, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Med",
  large: "Large",
  huge: "Huge",
  gargantuan: "Garg",
};

export interface TokenInfo {
  name: string;
  size: SizeCategory | "custom";
  customCells: number;
  layer: "CHARACTER" | "MOUNT" | "PROP";
  visible: boolean;
  showLabel: boolean;
}

export interface OutputSettings {
  exportSize: ExportSize;
  hosting: TokenHosting;
  placement: Placement;
}

export function Controls(props: {
  api: ApiClient;
  projectId: string;
  resourceId: string;
  images: PageImage[];
  imageId: string;
  onImage: (id: string) => void;
  source: RenderSource | null;
  style: TokenStyle;
  onStyle: (patch: Partial<TokenStyle>) => void;
  presetId: string | null;
  onPreset: (preset: FramePreset) => void;
  transform: ImageTransform;
  onTransform: (t: ImageTransform) => void;
  adjustments: ImageAdjustments;
  onAdjustments: (patch: Partial<ImageAdjustments>) => void;
  token: TokenInfo;
  onToken: (patch: Partial<TokenInfo>) => void;
  detectedSize: DetectedSize | null;
  cells: number;
  output: OutputSettings;
  onOutput: (patch: Partial<OutputSettings>) => void;
  hostingAvailable: boolean;
}) {
  const { style, onStyle, transform, onTransform, adjustments, onAdjustments, token, onToken, output, onOutput } = props;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const preset = FRAME_PRESETS.find((p) => p.id === props.presetId);
  const detected = props.detectedSize;

  return (
    <div className="panel-scroll scroll">
      <Section icon={<Frame className="lead" />} title="Frame & shape" note={preset?.name ?? "Custom"} open>
        <div className="shape-row" role="group" aria-label="Shape">
          {SHAPES.map((s) => (
            <button key={s.id} type="button" className="shape-btn" aria-pressed={style.shape === s.id} onClick={() => onStyle({ shape: s.id })}>
              <ShapeGlyph shape={s.id} />
              {s.name}
            </button>
          ))}
        </div>
        <div className="preset-grid" role="group" aria-label="Frame style">
          {FRAME_PRESETS.map((p) => (
            <button key={p.id} type="button" className="preset" aria-pressed={props.presetId === p.id} onClick={() => props.onPreset(p)}>
              <PresetPreview preset={p} style={style} source={props.source} transform={transform} />
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Paintbrush className="lead" />} title="Border & backing">
        {style.frame !== "none" && (
          <>
            <ColorPicker label="Border colour" value={style.frameColor} colors={FRAME_COLORS} onChange={(frameColor) => onStyle({ frameColor })} />
            <Slider label="Thickness" min={0.01} max={0.25} step={0.005} value={style.borderWidth} format={pct} onChange={(borderWidth) => onStyle({ borderWidth })} />
            <Slider label="Frame opacity" min={0.1} max={1} step={0.05} value={style.frameOpacity} format={pct} onChange={(frameOpacity) => onStyle({ frameOpacity })} />
          </>
        )}
        <Slider label="Outer spacing" min={0} max={0.2} step={0.005} value={style.margin} format={pct} onChange={(margin) => onStyle({ margin })} />
        <Slider label="Inner spacing" min={0} max={0.2} step={0.005} value={style.padding} format={pct} onChange={(padding) => onStyle({ padding })} />
        <ColorPicker
          label="Backing"
          value={style.backingColor}
          colors={BACKING_COLORS}
          allowTransparent
          transparent={style.backingOpacity === 0}
          onTransparent={() => onStyle({ backingOpacity: 0 })}
          onChange={(backingColor) => onStyle({ backingColor, backingOpacity: style.backingOpacity === 0 ? 1 : style.backingOpacity })}
        />
        {style.backingOpacity > 0 && (
          <Slider label="Backing opacity" min={0} max={1} step={0.05} value={style.backingOpacity} format={pct} onChange={(backingOpacity) => onStyle({ backingOpacity })} />
        )}
      </Section>

      <Section icon={<Crop className="lead" />} title="Crop & position" note={`${Math.round(transform.zoom * 100)}%${transform.rotation ? ` · ${Math.round(transform.rotation)}°` : ""}`}>
        <Slider label="Horizontal" min={-1.5} max={1.5} step={0.005} value={transform.offsetX} format={(v) => v.toFixed(2)} onChange={(offsetX) => onTransform({ ...transform, offsetX })} />
        <Slider label="Vertical" min={-1.5} max={1.5} step={0.005} value={transform.offsetY} format={(v) => v.toFixed(2)} onChange={(offsetY) => onTransform({ ...transform, offsetY })} />
        <Slider label="Rotation" min={-180} max={180} step={1} value={transform.rotation} format={(v) => `${Math.round(v)}°`} onChange={(rotation) => onTransform({ ...transform, rotation })} />
        <label className="check">
          <input type="checkbox" checked={transform.lockFill} onChange={(e) => onTransform({ ...transform, lockFill: e.target.checked })} />
          Keep the frame filled (no empty edges)
        </label>
      </Section>

      <Section icon={<ImageIcon className="lead" />} title="Image" note={props.images.length > 1 ? `${props.images.length} on page` : undefined} open={props.images.length > 1}>
        {props.images.length > 1 && (
          <div className="image-strip" role="group" aria-label="Page images">
            {props.images.map((img) => (
              <StripThumb key={img.id} api={props.api} projectId={props.projectId} resourceId={props.resourceId} image={img} selected={img.id === props.imageId} onSelect={() => props.onImage(img.id)} />
            ))}
          </div>
        )}
        <Slider label="Brightness" min={-100} max={100} value={adjustments.brightness} onChange={(brightness) => onAdjustments({ brightness })} />
        <Slider label="Contrast" min={-100} max={100} value={adjustments.contrast} onChange={(contrast) => onAdjustments({ contrast })} />
        <Slider label="Saturation" min={-100} max={100} value={adjustments.saturation} onChange={(saturation) => onAdjustments({ saturation })} />
        <label className="check">
          <input type="checkbox" checked={adjustments.removeBackground} onChange={(e) => onAdjustments({ removeBackground: e.target.checked })} />
          Remove flat background
        </label>
        {adjustments.removeBackground && (
          <Slider label="Tolerance" min={1} max={60} value={adjustments.backgroundTolerance} onChange={(backgroundTolerance) => onAdjustments({ backgroundTolerance })} />
        )}
      </Section>

      <Section icon={<UserRound className="lead" />} title="Token" note={token.size === "custom" ? `${props.cells}×${props.cells}` : SIZE_LABELS[token.size]} open>
        <Field label="Name" htmlFor="token-name" hint="Starts as the LegendKeeper page title.">
          <input id="token-name" className="input" value={token.name} maxLength={120} onChange={(e) => onToken({ name: e.target.value })} />
        </Field>
        <Field label="Creature size">
          <div className="stack" style={{ gap: 8 }}>
            <Segmented
              label="Creature size"
              fill
              value={token.size}
              onChange={(size) => onToken({ size })}
              options={[
                ...SIZE_CATEGORIES.map((c) => ({ value: c as SizeCategory | "custom", label: SHORT_SIZE[c], title: SIZE_LABELS[c] })),
                { value: "custom", label: "…", title: "Custom" },
              ]}
            />
            {detected ? (
              <div className="size-note">
                <Info aria-hidden />
                <span>
                  Detected <strong>{SIZE_LABELS[detected.category]}</strong> from {detected.origin}.
                </span>
              </div>
            ) : (
              <div className="size-note">
                <Info aria-hidden />
                <span>No size on this page. Using Medium; pick another if needed.</span>
              </div>
            )}
            {token.size === "custom" && (
              <Slider label="Squares" min={0.5} max={10} step={0.5} value={token.customCells} format={(v) => `${v}×${v}`} onChange={(customCells) => onToken({ customCells })} />
            )}
            <div className="footprint">
              <FootprintGrid cells={props.cells} />
              <span>
                Covers <strong>{props.cells < 1 ? "half a square" : `${props.cells} × ${props.cells} squares`}</strong>
                <br />
                <span className="faint small">Scaled to the scene's grid.</span>
              </span>
            </div>
          </div>
        </Field>
        <Field label="Layer">
          <Segmented
            label="Layer"
            fill
            value={token.layer}
            onChange={(layer) => onToken({ layer })}
            options={[
              { value: "CHARACTER", label: "Character" },
              { value: "MOUNT", label: "Mount" },
              { value: "PROP", label: "Prop" },
            ]}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!token.visible} onChange={(e) => onToken({ visible: !e.target.checked })} />
          Hidden from players
        </label>
        <label className="check">
          <input type="checkbox" checked={token.showLabel} onChange={(e) => onToken({ showLabel: e.target.checked })} />
          Show name label
        </label>
      </Section>

      <Section icon={<Settings2 className="lead" />} title="Output" note={`${output.exportSize} px`}>
        <Field label="Resolution" hint="512 px is crisp for tokens up to Huge.">
          <Segmented label="Resolution" fill value={output.exportSize} onChange={(exportSize) => onOutput({ exportSize })} options={[256, 512, 1024].map((n) => ({ value: n as ExportSize, label: `${n} px` }))} />
        </Field>
        <Field label="Image hosting">
          <Segmented
            label="Image hosting"
            fill
            value={output.hosting}
            onChange={(hosting) => onOutput({ hosting })}
            options={[
              { value: "backend", label: props.hostingAvailable ? "Importer server" : "Server (off)" },
              { value: "owlbear", label: "Owlbear storage" },
            ]}
          />
        </Field>
        <Field label="Placement">
          <Segmented
            label="Placement"
            fill
            value={output.placement}
            onChange={(placement) => onOutput({ placement })}
            options={[
              { value: "center", label: "Centre of view" },
              { value: "manual", label: "Click to place" },
            ]}
          />
        </Field>
      </Section>
    </div>
  );
}
