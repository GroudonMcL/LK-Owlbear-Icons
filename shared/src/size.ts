// Creature size detection and grid footprints.
//
// Detection only trusts structured places: a key/value row keyed "Size", a line
// that starts with "Size:", or a D&D statblock type line ("Large dragon, chaotic
// evil"). A bare "large" in prose is never treated as a size.

export const SIZE_CATEGORIES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export type SizeCategory = (typeof SIZE_CATEGORIES)[number];

export type SizeSource = "keyValue" | "field" | "statblock";

export interface DetectedSize {
  category: SizeCategory;
  source: SizeSource;
  /** Human-readable origin, e.g. `Sidebar property "Stats"`. */
  origin: string;
  /** The value as written, trimmed. */
  raw: string;
}

export const SIZE_LABELS: Record<SizeCategory, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan",
};

export interface FootprintOptions {
  /** Squares per side for Gargantuan; 4 by default, larger for colossal creatures. */
  gargantuanCells?: number;
  /** Squares per side for Tiny; 0.5 by default. */
  tinyCells?: number;
}

/** Grid squares per side occupied by a creature of the given size. */
export function footprintCells(category: SizeCategory, options: FootprintOptions = {}): number {
  switch (category) {
    case "tiny":
      return clampCells(options.tinyCells ?? 0.5);
    case "small":
    case "medium":
      return 1;
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return clampCells(options.gargantuanCells ?? 4);
  }
}

function clampCells(cells: number): number {
  if (!Number.isFinite(cells)) return 1;
  return Math.min(20, Math.max(0.25, cells));
}

const ABBREVIATIONS: Record<string, SizeCategory> = {
  t: "tiny",
  s: "small",
  m: "medium",
  med: "medium",
  l: "large",
  h: "huge",
  g: "gargantuan",
  garg: "gargantuan",
};

function normalise(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ \s]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parses a structured size value such as "Large", " medium ", "L",
 * "Medium or Small" (first wins) or "Huge (15 ft.)".
 */
export function parseSizeValue(value: string): SizeCategory | null {
  const v = normalise(value).replace(/[.;:,]+$/, "");
  if (!v) return null;
  const word = /^(tiny|small|medium|large|huge|gargantuan)\b/.exec(v);
  if (word) return word[1] as SizeCategory;
  return ABBREVIATIONS[v] ?? null;
}

export interface KeyValueCandidate {
  key: string;
  value: string;
  origin: string;
}

export function isSizeKey(key: string): boolean {
  const k = normalise(key).replace(/[:.]+$/, "");
  return k === "size" || k === "creature size" || k === "size category";
}

export function detectSizeFromKeyValues(rows: Iterable<KeyValueCandidate>): DetectedSize | null {
  for (const row of rows) {
    if (!isSizeKey(row.key)) continue;
    const category = parseSizeValue(row.value);
    if (category) return { category, source: "keyValue", origin: row.origin, raw: row.value.trim() };
  }
  return null;
}

const SIZE_WORD = "(?:tiny|small|medium|large|huge|gargantuan)";
const CREATURE_TYPE =
  "(?:aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead)s?";
const ALIGNMENT_START = "(?:any|unaligned|lawful|neutral|chaotic|typically|good|evil|true neutral)";

// "Size: Large", "Size - Medium", "Size — Huge"
const FIELD_LINE = /^\s*size\s*[:：\-–—]\s*(.+)$/i;

// "Large dragon, chaotic evil", "Medium or Small Humanoid (Elf), Neutral",
// "Medium swarm of Tiny beasts, unaligned"
const STATBLOCK_LINE = new RegExp(
  `^\\s*(${SIZE_WORD})(?:\\s+or\\s+${SIZE_WORD})?\\s+` +
    `(?:${CREATURE_TYPE}|swarm\\s+of\\s+${SIZE_WORD}\\s+${CREATURE_TYPE})` +
    `(?:\\s*\\([^)]{0,60}\\))?\\s*,\\s*${ALIGNMENT_START}\\b`,
  "i",
);

/** Statblock type lines are short; long lines are prose. */
const MAX_STATBLOCK_LINE = 100;

export interface TextLineCandidate {
  text: string;
  origin: string;
}

export function detectSizeFromLines(lines: Iterable<TextLineCandidate>): DetectedSize | null {
  const all = [...lines];
  for (const line of all) {
    const m = FIELD_LINE.exec(line.text);
    if (!m) continue;
    const category = parseSizeValue(m[1]);
    if (category) return { category, source: "field", origin: line.origin, raw: line.text.trim() };
  }
  for (const line of all) {
    if (line.text.length > MAX_STATBLOCK_LINE) continue;
    const m = STATBLOCK_LINE.exec(line.text);
    if (m) {
      return {
        category: m[1].toLowerCase() as SizeCategory,
        source: "statblock",
        origin: line.origin,
        raw: line.text.trim(),
      };
    }
  }
  return null;
}

/** Key/value rows win over text lines, which win over statblock type lines. */
export function detectSize(
  keyValues: Iterable<KeyValueCandidate>,
  lines: Iterable<TextLineCandidate>,
): DetectedSize | null {
  return detectSizeFromKeyValues(keyValues) ?? detectSizeFromLines(lines);
}
