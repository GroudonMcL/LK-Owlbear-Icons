import { useEffect, useState } from "react";
import { asLinkable } from "../lib/existing";
import { collectSceneLinks, type SceneLinks } from "../lib/links";
import type { Platform } from "../platform/types";

/** Live map of linked tokens in the open scene, or null while unknown. */
export function useSceneLinks(platform: Platform): SceneLinks | null {
  const [links, setLinks] = useState<SceneLinks | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        if (!(await platform.isSceneReady())) return alive && setLinks(null);
        const items = await platform.getItems();
        if (alive) setLinks(collectSceneLinks(asLinkable(items)));
      } catch {
        if (alive) setLinks(null);
      }
    };
    void load();
    const offItems = platform.onItemsChange((items) => setLinks(collectSceneLinks(asLinkable(items))));
    const offReady = platform.onSceneReadyChange(() => void load());
    return () => {
      alive = false;
      offItems();
      offReady();
    };
  }, [platform]);
  return links;
}
