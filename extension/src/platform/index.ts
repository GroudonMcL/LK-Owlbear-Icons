import OBR from "@owlbear-rodeo/sdk";
import { obrPlatform } from "./obr";
import type { Platform } from "./types";

export type { Platform } from "./types";

/**
 * Resolves the platform: Owlbear Rodeo when embedded in it, the mock only on
 * the dev server with `?mock`, otherwise null (opened outside Owlbear).
 */
export async function resolvePlatform(): Promise<Platform | null> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    return (await import("./mock")).mockPlatform;
  }
  if (!OBR.isAvailable) return null;
  await obrPlatform.whenReady();
  return obrPlatform;
}
