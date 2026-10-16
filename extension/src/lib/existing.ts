import type { Item } from "@owlbear-rodeo/sdk";
import type { Platform } from "../platform/types";
import { collectSceneLinks, linkKey, matchTokens, type LinkableItem, type TokenMatch } from "./links";
import {
  newSceneKey,
  otherScenesFor,
  parseIndex,
  parseSceneKey,
  reconcileScene,
  ROOM_INDEX_KEY,
  sameIndex,
  SCENE_KEY,
} from "./roomIndex";

export type ExistingState =
  | { kind: "checking" }
  | { kind: "no-scene" }
  /** The live lookup failed: we do not know whether a token exists. */
  | { kind: "error"; message: string }
  | { kind: "ready"; here: TokenMatch[]; otherScenes: number };

export function asLinkable(items: Item[]): LinkableItem[] {
  return items as unknown as LinkableItem[];
}

/** This scene's key, created on first use. Null if the scene metadata cannot be written. */
export async function ensureSceneKey(platform: Platform, create: boolean): Promise<string | null> {
  const existing = parseSceneKey((await platform.getSceneMetadata())[SCENE_KEY]);
  if (existing || !create) return existing;
  const id = newSceneKey();
  await platform.setSceneMetadata({ [SCENE_KEY]: { id } });
  return id;
}

/**
 * Checks for tokens linked to a page. The current scene is read live; other
 * scenes come from the room index, which can only say that tokens were there
 * when that scene was last open.
 */
export async function lookupExisting(
  platform: Platform,
  projectId: string,
  resourceId: string,
  currentTitle: string,
): Promise<ExistingState> {
  try {
    if (!(await platform.isSceneReady())) return { kind: "no-scene" };
    const items = await platform.getItems();
    const here = matchTokens(asLinkable(items), projectId, resourceId, currentTitle);
    let otherScenes = 0;
    try {
      const [room, sceneKey] = await Promise.all([platform.getRoomMetadata(), ensureSceneKey(platform, false)]);
      otherScenes = otherScenesFor(parseIndex(room[ROOM_INDEX_KEY]), linkKey(projectId, resourceId), sceneKey).length;
    } catch {
      // The index is advisory; a failure here must not hide live results.
    }
    return { kind: "ready", here, otherScenes };
  } catch (err) {
    return {
      kind: "error",
      message: `Couldn't read the scene to check for existing tokens${err instanceof Error ? ` (${err.message})` : ""}.`,
    };
  }
}

/** Rewrites this scene's part of the room index from its actual items. GM only. */
export async function syncRoomIndex(platform: Platform, items: Item[]): Promise<void> {
  const { byPage } = collectSceneLinks(asLinkable(items));
  const room = await platform.getRoomMetadata();
  const current = parseIndex(room[ROOM_INDEX_KEY]);
  let sceneKey = await ensureSceneKey(platform, false);
  if (!sceneKey) {
    // Untracked scene with nothing linked and nothing indexed: nothing to do.
    if (byPage.size === 0) return;
    sceneKey = await ensureSceneKey(platform, true);
    if (!sceneKey) return;
  }
  const present = new Map([...byPage].map(([key, tokens]) => [key, tokens[0].link.title || tokens[0].item.name]));
  const next = reconcileScene(current, sceneKey, present, Math.floor(Date.now() / 1000));
  if (!sameIndex(current, next)) await platform.setRoomMetadata({ [ROOM_INDEX_KEY]: next });
}
