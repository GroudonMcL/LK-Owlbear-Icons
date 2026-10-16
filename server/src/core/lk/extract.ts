import {
  detectSize,
  type DetectedSize,
  type KeyValueCandidate,
  type PageImage,
  type TextLineCandidate,
} from "@lkti/shared";
import { sha256Hex } from "../tokenStore.js";
import type { LkDocument, LkNode, LkResource } from "./types.js";

export interface ExtractedImage extends PageImage {
  /** Upstream URL; stays on the server. */
  url: string;
}

export interface ExtractInput {
  resource: LkResource;
  /** Page documents in display order; `blocks` is null when the document could not be read. */
  documents: { doc: LkDocument; blocks: LkNode[] | null }[];
}

export interface ExtractResult {
  images: ExtractedImage[];
  keyValues: KeyValueCandidate[];
  lines: TextLineCandidate[];
  size: DetectedSize | null;
}

const MAX_DEPTH = 64;

export async function imageIdFor(url: string): Promise<string> {
  return (await sha256Hex(url)).slice(0, 24);
}

/** Text of a run array: plain text, mention labels, and line breaks as "\n". */
export function runsToText(runs: unknown): string {
  if (!Array.isArray(runs)) return "";
  let out = "";
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    const r = run as Record<string, unknown>;
    if (typeof r.text === "string") out += r.text;
    else if (r.mention && typeof r.mention === "object") {
      const m = r.mention as Record<string, unknown>;
      out += typeof m.text === "string" && m.text ? m.text : typeof m.name === "string" ? m.name : "";
    } else if (r.break === true) out += "\n";
  }
  return out;
}

function rowValue(row: Record<string, unknown>): string {
  const fromRuns = runsToText(row.content);
  if (fromRuns) return fromRuns;
  return typeof row.text === "string" ? row.text : "";
}

/** All text inside a node, used for table cells. */
function nodeText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return "";
  const n = node as LkNode;
  const parts: string[] = [];
  if (Array.isArray(n.content)) parts.push(runsToText(n.content));
  if (Array.isArray(n.children)) for (const c of n.children) parts.push(nodeText(c, depth + 1));
  return parts.filter(Boolean).join(" ").trim();
}

function isUsableImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  return /^https?:\/\//i.test(url);
}

const DEFAULT_IMAGE_TITLES = new Set(["image", ""]);

class Collector {
  readonly images: ExtractedImage[] = [];
  readonly keyValues: KeyValueCandidate[] = [];
  readonly lines: TextLineCandidate[] = [];
  private readonly seenUrls = new Set<string>();

  addImage(url: unknown, image: Omit<ExtractedImage, "id" | "url">): void {
    if (!isUsableImageUrl(url) || this.seenUrls.has(url)) return;
    this.seenUrls.add(url);
    this.images.push({ ...image, id: "", url });
  }

  addLines(text: string, origin: string): void {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line) this.lines.push({ text: line, origin });
    }
  }

  addRows(rows: unknown, origin: string): void {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.key !== "string") continue;
      this.keyValues.push({ key: r.key, value: rowValue(r), origin });
    }
  }
}

function imageLabel(node: LkNode, fallback: string): string {
  const title = typeof node.title === "string" ? node.title.trim() : "";
  if (title && !DEFAULT_IMAGE_TITLES.has(title.toLowerCase())) return title;
  const alt = typeof node.alt === "string" ? node.alt.trim() : "";
  return alt || fallback;
}

interface WalkContext {
  collector: Collector;
  documentName?: string;
  /** Where we are, for origins: "Infobox", "Sidebar", ... */
  container: string;
  imageCounter: { n: number };
}

function describe(ctx: WalkContext): string {
  const doc = ctx.documentName ? `"${ctx.documentName}"` : "page";
  if (ctx.container === "Sidebar") return "sidebar";
  if (ctx.container === "Infobox") return `infobox on ${doc}`;
  return doc;
}

function walk(node: unknown, ctx: WalkContext, depth: number): void {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
  const n = node as LkNode;
  const where = describe(ctx);

  switch (n.kind) {
    case "image": {
      ctx.imageCounter.n += 1;
      const fallback = ctx.documentName ? `${ctx.documentName} · image ${ctx.imageCounter.n}` : `Image ${ctx.imageCounter.n}`;
      ctx.collector.addImage(n.url, {
        source: ctx.container === "Sidebar" ? "property" : "block",
        label: imageLabel(n, fallback),
        ...(typeof n.alt === "string" && n.alt ? { alt: n.alt } : {}),
        ...(ctx.documentName ? { documentName: ctx.documentName } : {}),
      });
      return;
    }
    case "keyValue": {
      const title = typeof n.title === "string" && n.title ? `"${n.title}"` : "Key/value block";
      ctx.collector.addRows(n.rows, `${title} in ${where}`);
      return;
    }
    case "infobox": {
      if (Array.isArray(n.rows)) for (const row of n.rows) walk(row, { ...ctx, container: "Infobox" }, depth + 1);
      return;
    }
    case "tableRow": {
      // A two-cell row ("Size" | "Large") is treated as a key/value pair.
      const cells = Array.isArray(n.children) ? n.children : [];
      if (cells.length === 2) {
        const key = nodeText(cells[0]);
        const value = nodeText(cells[1]);
        if (key && value && key.length <= 40) ctx.collector.keyValues.push({ key, value, origin: `Table in ${where}` });
      }
      break;
    }
    default:
      // Containers (layout, callout, secret, expand, textField, ...) recurse below.
      break;
  }

  if (Array.isArray(n.content)) ctx.collector.addLines(runsToText(n.content), where);
  if (Array.isArray(n.children)) for (const child of n.children) walk(child, ctx, depth + 1);
}

/**
 * Pulls the images, key/value rows and text lines out of a page, and detects
 * the creature size. Images come in the order a reader meets them: sidebar
 * images, then document images, then the page image and banner.
 */
export async function extractPage(input: ExtractInput): Promise<ExtractResult> {
  const collector = new Collector();
  const imageCounter = { n: 0 };

  for (const property of input.resource.properties ?? []) {
    walk(property, { collector, container: "Sidebar", imageCounter }, 0);
  }

  for (const { doc, blocks } of input.documents) {
    if (!blocks) continue;
    const docCounter = { n: 0 };
    for (const block of blocks) {
      walk(block, { collector, documentName: doc.name, container: "Document", imageCounter: docCounter }, 0);
    }
  }

  collector.addImage(input.resource.imageUrl, { source: "resource", label: "Page image" });
  if (input.resource.banner?.url) {
    collector.addImage(input.resource.banner.url, { source: "banner", label: "Banner" });
  }

  for (const image of collector.images) image.id = await imageIdFor(image.url);
  return {
    images: collector.images,
    keyValues: collector.keyValues,
    lines: collector.lines,
    size: detectSize(collector.keyValues, collector.lines),
  };
}
