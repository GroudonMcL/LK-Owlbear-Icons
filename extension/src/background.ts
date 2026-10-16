// Runs for the lifetime of the room (manifest background_url). It owns the
// pieces that must outlive the popover and editor: the context menu on linked
// tokens, click-to-place, and keeping the room's cross-scene index current.

import OBR, { type Item, type Vector2 } from "@owlbear-rodeo/sdk";
import { ApiClient } from "./lib/api";
import { syncRoomIndex } from "./lib/existing";
import { LINK_KEY, parseLink } from "./lib/links";
import { loadSettings, requestNavigation } from "./lib/settings";
import {
  CH_PLACE,
  CH_TOKEN_CREATED,
  CONTEXT_MENU_ID,
  extensionUrl,
  PLACE_MODE_ID,
  PLACE_TOOL_ID,
} from "./platform/channels";
import { obrPlatform } from "./platform/obr";
import type { PlacementRequest } from "./platform/types";

const FALLBACK_TOOL = "rodeo.owlbear.tool/move";

function setupContextMenu(): Promise<void> {
  return OBR.contextMenu.create({
    id: CONTEXT_MENU_ID,
    icons: [
      {
        icon: extensionUrl("icons/scroll.svg"),
        label: "LegendKeeper page",
        filter: {
          roles: ["GM"],
          max: 1,
          every: [{ key: ["metadata", LINK_KEY, "resourceId"], value: undefined, operator: "!=" }],
        },
      },
    ],
    async onClick(context) {
      const parsed = parseLink(context.items[0]?.metadata);
      if (parsed?.status !== "valid") {
        await OBR.notification.show("This token's LegendKeeper link is unreadable.", "WARNING");
        return;
      }
      requestNavigation({ projectId: parsed.link.projectId, resourceId: parsed.link.resourceId, title: parsed.link.title });
      await OBR.action.open();
    },
  });
}

// Click-to-place ---------------------------------------------------------

let pending: PlacementRequest | null = null;
let ghostId: string | null = null;
let previousTool: string | null = null;

async function teardownTool(): Promise<void> {
  const restore = previousTool && previousTool !== PLACE_TOOL_ID ? previousTool : FALLBACK_TOOL;
  previousTool = null;
  try {
    await OBR.tool.activateTool(restore);
  } catch {
    await OBR.tool.activateTool(FALLBACK_TOOL).catch(() => undefined);
  }
  await OBR.tool.removeMode(PLACE_MODE_ID).catch(() => undefined);
  await OBR.tool.remove(PLACE_TOOL_ID).catch(() => undefined);
}

async function removeGhost(): Promise<void> {
  if (!ghostId) return;
  const id = ghostId;
  ghostId = null;
  await OBR.scene.local.deleteItems([id]).catch(() => undefined);
}

async function cancelPlacement(reason: string): Promise<void> {
  const request = pending;
  if (!request) return;
  pending = null;
  await removeGhost();
  await teardownTool();
  if (request.cleanupHash) {
    const settings = loadSettings();
    if (settings.backendUrl && settings.accessToken) {
      await new ApiClient(settings).deleteToken(request.cleanupHash).catch(() => undefined);
    }
  }
  await OBR.notification.show(reason, "INFO");
}

async function place(at: Vector2): Promise<void> {
  const request = pending;
  if (!request) return;
  pending = null; // before switching tools, so onDeactivate doesn't cancel
  await removeGhost();
  const position = await obrPlatform.snap(at, request.cells);
  const item = { ...request.item, position } as Item;
  try {
    await OBR.scene.items.addItems([item]);
  } catch (err) {
    await teardownTool();
    await OBR.notification.show(`Couldn't place the token: ${(err as Error).message}`, "ERROR");
    return;
  }
  await teardownTool();
  await OBR.player.select([item.id], true).catch(() => undefined);
  await OBR.notification.show(`Placed ${item.name}.`, "SUCCESS");
  await obrPlatform.sendLocal(CH_TOKEN_CREATED, {}).catch(() => undefined);
}

async function moveGhost(at: Vector2): Promise<void> {
  if (!pending) return;
  if (!ghostId) {
    ghostId = `${pending.item.id}-ghost`;
    const ghost = { ...pending.item, id: ghostId, position: at, metadata: {}, disableHit: true, locked: true } as Item;
    await OBR.scene.local.addItems([ghost]).catch(() => (ghostId = null));
    return;
  }
  const id = ghostId;
  await OBR.scene.local
    .updateItems([id], (items) => items.forEach((i) => (i.position = at)), true)
    .catch(() => undefined);
}

async function startPlacement(request: PlacementRequest): Promise<void> {
  if (pending) await cancelPlacement("Previous placement replaced.");
  pending = request;
  previousTool = await OBR.tool.getActiveTool().catch(() => null);
  const icon = extensionUrl("icons/place.svg");
  await OBR.tool.create({
    id: PLACE_TOOL_ID,
    icons: [{ icon, label: "Place LegendKeeper token", filter: { roles: ["GM"] } }],
    defaultMode: PLACE_MODE_ID,
  });
  await OBR.tool.createMode({
    id: PLACE_MODE_ID,
    icons: [{ icon, label: "Click to place", filter: { activeTools: [PLACE_TOOL_ID] } }],
    cursors: [{ cursor: "crosshair" }],
    onToolMove: (_ctx, event) => void moveGhost(event.pointerPosition),
    onToolClick: (_ctx, event) => {
      void place(event.pointerPosition);
      return false;
    },
    onKeyDown: (_ctx, event) => {
      if (event.key === "Escape") void cancelPlacement("Placement cancelled.");
    },
    onDeactivate: () => {
      if (pending) void cancelPlacement("Placement cancelled.");
    },
  });
  await OBR.tool.activateTool(PLACE_TOOL_ID);
  await OBR.notification.show(`Click on the map to place ${request.item.name}. Press Esc to cancel.`, "INFO");
}

// Room index ------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleIndexSync(): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      if ((await OBR.player.getRole()) !== "GM" || !(await OBR.scene.isReady())) return;
      await syncRoomIndex(obrPlatform, await OBR.scene.items.getItems());
    } catch (err) {
      console.warn("[LK token importer] index sync failed", err);
    }
  }, 1500);
}

OBR.onReady(async () => {
  await setupContextMenu();
  OBR.broadcast.onMessage(CH_PLACE, (event) => void startPlacement(event.data as PlacementRequest));
  OBR.scene.items.onChange(scheduleIndexSync);
  OBR.scene.onReadyChange((ready) => ready && scheduleIndexSync());
  if (await OBR.scene.isReady()) scheduleIndexSync();
});
