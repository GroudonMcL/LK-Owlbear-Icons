// Turns an edited token into an Owlbear item: export → host → build → place.

import type { ImageContent, Item, Layer } from "@owlbear-rodeo/sdk";
import type { Platform } from "../platform/types";
import { CH_TOKEN_CREATED } from "../platform/channels";
import type { ApiClient } from "./api";
import { asLinkable, syncRoomIndex } from "./existing";
import { createLink, LINK_KEY, parseLink } from "./links";
import type { Placement, TokenHosting } from "./settings";

export interface CreateTokenRequest {
  projectId: string;
  resourceId: string;
  pageTitle: string;
  name: string;
  png: Blob;
  pixelSize: number;
  cells: number;
  layer: Layer;
  visible: boolean;
  showLabel: boolean;
  hosting: TokenHosting;
  placement: Placement;
  /** Stable per editor session: a retried click never makes a second token. */
  importId: string;
}

export type CreateTokenResult =
  | { status: "created"; itemId: string }
  | { status: "placing" }
  | { status: "already-created"; itemId: string }
  | { status: "cancelled" };

async function existingImport(platform: Platform, importId: string): Promise<Item | null> {
  const items = await platform.getItems();
  return (
    (asLinkable(items).find((item) => {
      const parsed = parseLink(item.metadata);
      return parsed?.status === "valid" && parsed.link.importId === importId;
    }) as unknown as Item | undefined) ?? null
  );
}

export async function createToken(platform: Platform, api: ApiClient | null, req: CreateTokenRequest): Promise<CreateTokenResult> {
  // A previous attempt may have succeeded even if its response was lost.
  const earlier = await existingImport(platform, req.importId);
  if (earlier) return { status: "already-created", itemId: earlier.id };

  let image: ImageContent | null;
  let cleanupHash: string | null = null;
  if (req.hosting === "backend") {
    if (!api) throw new Error("Connect the importer server in Settings, or switch hosting to Owlbear storage.");
    const uploaded = await api.uploadToken(req.png);
    image = { url: uploaded.url, width: uploaded.width, height: uploaded.height, mime: uploaded.mime };
    cleanupHash = uploaded.created ? uploaded.hash : null;
  } else {
    const file = new File([req.png], `${req.name.replace(/[^\w\- ]+/g, "").trim() || "token"}.png`, { type: "image/png" });
    image = await platform.uploadToOwlbearStorage(file, req.name, req.pixelSize / req.cells);
    if (!image) return { status: "cancelled" };
  }

  const position = await platform.snap(await platform.viewportCenter(), req.cells);
  const item = platform.buildTokenItem({
    name: req.name,
    image,
    // Footprint: the image spans `cells` grid squares whatever its pixel size.
    dpi: image.width / req.cells,
    position,
    layer: req.layer,
    visible: req.visible,
    showLabel: req.showLabel,
    metadata: { [LINK_KEY]: createLink(req.projectId, req.resourceId, req.pageTitle, req.importId) },
  });

  try {
    if (req.placement === "manual") {
      await platform.startPlacement({ item, cells: req.cells, cleanupHash });
      return { status: "placing" };
    }
    await platform.addItems([item]);
  } catch (err) {
    // Don't leave an orphaned image behind if the token never made it into the scene.
    if (cleanupHash && api) await api.deleteToken(cleanupHash).catch(() => undefined);
    throw err;
  }

  await platform.selectAndFocus([item.id]).catch(() => undefined);
  await platform.sendLocal(CH_TOKEN_CREATED, { projectId: req.projectId, resourceId: req.resourceId }).catch(() => undefined);
  try {
    await syncRoomIndex(platform, await platform.getItems());
  } catch {
    // The background page also keeps the index in sync.
  }
  return { status: "created", itemId: item.id };
}
