// Cross-scene awareness. Owlbear only exposes the open scene's items, so the
// room keeps a small index of which scenes hold tokens for which pages. Each
// scene's entries are rebuilt from its real items whenever it is open, so
// deletions and copies correct themselves; the index is advisory and never
// replaces a live lookup of the current scene.

import { NAMESPACE } from "./links";

export const ROOM_INDEX_KEY = `${NAMESPACE}/index`;
export const SCENE_KEY = `${NAMESPACE}/scene`;
/** Room metadata is capped at 16 kB for all extensions together; use at most half. */
export const MAX_INDEX_BYTES = 7_500;

export interface RoomIndexEntry {
  /** Page title, truncated, to describe the entry. */
  t: string;
  /** Scene keys holding at least one token linked to this page. */
  s: string[];
  /** Last update, epoch seconds; used to evict the stalest entries. */
  u: number;
}

export interface RoomIndex {
  v: 1;
  entries: Record<string, RoomIndexEntry>;
}

export function emptyIndex(): RoomIndex {
  return { v: 1, entries: {} };
}

export function parseIndex(raw: unknown): RoomIndex {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const r = raw as Partial<RoomIndex>;
  if (r.v !== 1 || !r.entries || typeof r.entries !== "object") return emptyIndex();
  const entries: Record<string, RoomIndexEntry> = {};
  for (const [key, value] of Object.entries(r.entries)) {
    if (!value || !Array.isArray(value.s)) continue;
    const scenes = value.s.filter((s): s is string => typeof s === "string");
    if (scenes.length) entries[key] = { t: String(value.t ?? ""), s: scenes, u: Number(value.u) || 0 };
  }
  return { v: 1, entries };
}

export function parseSceneKey(raw: unknown): string | null {
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
    const id = (raw as { id: string }).id;
    if (/^[a-z0-9]{6,32}$/.test(id)) return id;
  }
  return null;
}

/**
 * Replaces everything the index says about `sceneKey` with what the scene
 * actually holds (`present`: linkKey → page title).
 */
export function reconcileScene(index: RoomIndex, sceneKey: string, present: Map<string, string>, nowSeconds: number): RoomIndex {
  const entries: Record<string, RoomIndexEntry> = {};
  for (const [key, entry] of Object.entries(index.entries)) {
    const scenes = entry.s.filter((s) => s !== sceneKey);
    if (present.has(key)) {
      entries[key] = { t: (present.get(key) || entry.t).slice(0, 40), s: [...scenes, sceneKey], u: nowSeconds };
    } else if (scenes.length) {
      entries[key] = { ...entry, s: scenes };
    }
  }
  for (const [key, title] of present) {
    if (!entries[key]) entries[key] = { t: title.slice(0, 40), s: [sceneKey], u: nowSeconds };
  }
  return enforceBudget({ v: 1, entries });
}

/** Drops the least recently updated entries until the index fits its budget. */
export function enforceBudget(index: RoomIndex, maxBytes = MAX_INDEX_BYTES): RoomIndex {
  const entries = { ...index.entries };
  const size = () => new TextEncoder().encode(JSON.stringify({ v: 1, entries })).length;
  if (size() <= maxBytes) return { v: 1, entries };
  const byAge = Object.entries(entries).sort((a, b) => a[1].u - b[1].u);
  for (const [key] of byAge) {
    delete entries[key];
    if (size() <= maxBytes) break;
  }
  return { v: 1, entries };
}

/** Other scenes (not `currentSceneKey`) that hold tokens for a page. */
export function otherScenesFor(index: RoomIndex, key: string, currentSceneKey: string | null): string[] {
  return (index.entries[key]?.s ?? []).filter((s) => s !== currentSceneKey);
}

export function sameIndex(a: RoomIndex, b: RoomIndex): boolean {
  const norm = (i: RoomIndex) =>
    JSON.stringify(
      Object.entries(i.entries)
        .map(([k, e]) => [k, e.t, [...e.s].sort()])
        .sort(),
    );
  return norm(a) === norm(b);
}

export function newSceneKey(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
