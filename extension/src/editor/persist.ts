// Remembers the last frame setup so a session of imports doesn't need
// reconfiguring for every token.

import { DEFAULT_STYLE, FRAME_PRESETS, SHAPES, type TokenStyle } from "./model";

const KEY = "lkti.editor.style.v1";

export interface SavedLook {
  style: TokenStyle;
  presetId: string | null;
}

export function loadLook(): SavedLook {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SavedLook> | null;
    if (!raw?.style) return { style: DEFAULT_STYLE, presetId: FRAME_PRESETS[0].id };
    const style = { ...DEFAULT_STYLE, ...raw.style };
    if (!SHAPES.some((s) => s.id === style.shape)) style.shape = DEFAULT_STYLE.shape;
    return { style, presetId: raw.presetId ?? null };
  } catch {
    return { style: DEFAULT_STYLE, presetId: FRAME_PRESETS[0].id };
  }
}

export function saveLook(look: SavedLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Not essential.
  }
}
