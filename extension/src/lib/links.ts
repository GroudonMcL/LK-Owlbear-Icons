// Page-to-token links. A linked token carries one namespaced metadata entry
// naming its LegendKeeper project and page. Ids, not titles, are the identity:
// titles change and different pages can share a name.

export const NAMESPACE = "io.github.groudonmcl.lk-token-importer";
export const LINK_KEY = `${NAMESPACE}/link`;
export const LINK_VERSION = 1;

export interface TokenLink {
  v: typeof LINK_VERSION;
  projectId: string;
  resourceId: string;
  /** Page title when the link was made or last refreshed; for display only. */
  title: string;
  /** ISO time the link was made. */
  linkedAt: string;
  /** Random id of the import that created the token; guards against double-creation. */
  importId: string;
}

/** The minimal shape of an Owlbear item this module needs. */
export interface LinkableItem {
  id: string;
  name: string;
  type: string;
  layer?: string;
  metadata: Record<string, unknown>;
  image?: { url: string };
  visible?: boolean;
}

export type ParsedLink = { status: "valid"; link: TokenLink } | { status: "invalid"; reason: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function linkKey(projectId: string, resourceId: string): string {
  return `${projectId}:${resourceId}`;
}

export function createLink(projectId: string, resourceId: string, title: string, importId: string, now = new Date()): TokenLink {
  return {
    v: LINK_VERSION,
    projectId,
    resourceId,
    title: title.slice(0, 200),
    linkedAt: now.toISOString(),
    importId,
  };
}

/** Reads the link from an item's metadata. Null when the item was never linked. */
export function parseLink(metadata: Record<string, unknown> | undefined): ParsedLink | null {
  if (!metadata || !(LINK_KEY in metadata)) return null;
  const raw = metadata[LINK_KEY];
  if (!raw || typeof raw !== "object") return { status: "invalid", reason: "Link data is not an object." };
  const r = raw as Record<string, unknown>;
  if (r.v !== LINK_VERSION) return { status: "invalid", reason: `Unknown link version ${String(r.v)}.` };
  if (typeof r.projectId !== "string" || !ID.test(r.projectId)) return { status: "invalid", reason: "Missing project id." };
  if (typeof r.resourceId !== "string" || !ID.test(r.resourceId)) return { status: "invalid", reason: "Missing page id." };
  return {
    status: "valid",
    link: {
      v: LINK_VERSION,
      projectId: r.projectId,
      resourceId: r.resourceId,
      title: typeof r.title === "string" ? r.title : "",
      linkedAt: typeof r.linkedAt === "string" ? r.linkedAt : "",
      importId: typeof r.importId === "string" ? r.importId : "",
    },
  };
}

export interface LinkedToken {
  item: LinkableItem;
  link: TokenLink;
}

export interface SceneLinks {
  /** Valid links grouped by `linkKey`. */
  byPage: Map<string, LinkedToken[]>;
  /** Items carrying our metadata key with unreadable contents. */
  invalid: { item: LinkableItem; reason: string }[];
}

export function collectSceneLinks(items: LinkableItem[]): SceneLinks {
  const byPage = new Map<string, LinkedToken[]>();
  const invalid: SceneLinks["invalid"] = [];
  for (const item of items) {
    const parsed = parseLink(item.metadata);
    if (!parsed) continue;
    if (parsed.status === "invalid") {
      invalid.push({ item, reason: parsed.reason });
      continue;
    }
    const key = linkKey(parsed.link.projectId, parsed.link.resourceId);
    const list = byPage.get(key) ?? [];
    list.push({ item, link: parsed.link });
    byPage.set(key, list);
  }
  return { byPage, invalid };
}

export interface TokenMatch extends LinkedToken {
  /** The token's name no longer matches the page title. */
  nameDiffers: boolean;
  /** The page was renamed since the link was made or refreshed. */
  pageRenamed: boolean;
  /** Another token shares this link (e.g. an Owlbear copy). */
  duplicate: boolean;
}

/** Tokens linked to one page, flagged for renames and copies. */
export function matchTokens(items: LinkableItem[], projectId: string, resourceId: string, currentTitle?: string): TokenMatch[] {
  const linked = collectSceneLinks(items).byPage.get(linkKey(projectId, resourceId)) ?? [];
  return linked.map(({ item, link }) => ({
    item,
    link,
    nameDiffers: currentTitle !== undefined && item.name.trim() !== currentTitle.trim(),
    pageRenamed: currentTitle !== undefined && link.title !== "" && link.title !== currentTitle,
    duplicate: linked.length > 1,
  }));
}

export function newImportId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}
