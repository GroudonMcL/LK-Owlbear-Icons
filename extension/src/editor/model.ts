// Token editor state. All lengths are fractions of the token's half-size R, so
// the same settings render identically at preview and export resolution.

export type ShapeId = "circle" | "rounded" | "square" | "hexagon" | "hexagonFlat";

export type FrameStyle = "none" | "line" | "double" | "gilded" | "engraved" | "arcane" | "riveted";

export interface TokenStyle {
  shape: ShapeId;
  frame: FrameStyle;
  frameColor: string;
  /** Border thickness, fraction of R (0–0.25). */
  borderWidth: number;
  /** Gap between the canvas edge and the frame, fraction of R (0–0.2). */
  margin: number;
  /** Gap between the frame and the image, filled with the backing, fraction of R (0–0.2). */
  padding: number;
  backingColor: string;
  /** 0 = transparent backing. */
  backingOpacity: number;
  frameOpacity: number;
}

export interface ImageTransform {
  /** Multiplier on the scale that exactly covers the frame at 0°. */
  zoom: number;
  /** Image centre offset from the token centre, fractions of R. */
  offsetX: number;
  offsetY: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  /** Keep the image covering the frame (no empty corners). */
  lockFill: boolean;
}

export interface ImageAdjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  removeBackground: boolean;
  /** 0..100 colour distance tolerance for background removal. */
  backgroundTolerance: number;
}

export const DEFAULT_TRANSFORM: ImageTransform = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  lockFill: true,
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  removeBackground: false,
  backgroundTolerance: 18,
};

export interface FramePreset {
  id: string;
  name: string;
  style: Pick<TokenStyle, "frame" | "frameColor" | "borderWidth" | "margin">;
}

/** A small, cohesive set: a few excellent frames beats many inconsistent ones. */
export const FRAME_PRESETS: FramePreset[] = [
  { id: "gilded", name: "Gilded", style: { frame: "gilded", frameColor: "#d4a64a", borderWidth: 0.1, margin: 0.04 } },
  { id: "silver", name: "Silver", style: { frame: "gilded", frameColor: "#b8c2cf", borderWidth: 0.1, margin: 0.04 } },
  { id: "engraved", name: "Engraved", style: { frame: "engraved", frameColor: "#7a7f8a", borderWidth: 0.12, margin: 0.04 } },
  { id: "bronze", name: "Iron-bound", style: { frame: "riveted", frameColor: "#9a6a3c", borderWidth: 0.12, margin: 0.04 } },
  { id: "arcane", name: "Arcane", style: { frame: "arcane", frameColor: "#6fc3ff", borderWidth: 0.07, margin: 0.11 } },
  { id: "infernal", name: "Infernal", style: { frame: "arcane", frameColor: "#ff6a3d", borderWidth: 0.07, margin: 0.11 } },
  { id: "double", name: "Double line", style: { frame: "double", frameColor: "#e8d6a8", borderWidth: 0.08, margin: 0.02 } },
  { id: "minimal", name: "Minimal", style: { frame: "line", frameColor: "#f4f1ea", borderWidth: 0.045, margin: 0.01 } },
  { id: "none", name: "No frame", style: { frame: "none", frameColor: "#ffffff", borderWidth: 0, margin: 0 } },
];

export const DEFAULT_STYLE: TokenStyle = {
  shape: "circle",
  ...FRAME_PRESETS[0].style,
  padding: 0,
  backingColor: "#1d1f27",
  backingOpacity: 1,
  frameOpacity: 1,
};

export const SHAPES: { id: ShapeId; name: string }[] = [
  { id: "circle", name: "Circle" },
  { id: "rounded", name: "Rounded" },
  { id: "square", name: "Square" },
  { id: "hexagon", name: "Hexagon" },
  { id: "hexagonFlat", name: "Flat hex" },
];

export const EXPORT_SIZES = [256, 512, 1024] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];

export const ZOOM_MAX = 8;
