// Per-browser settings for the GM. The access token here is for this
// extension's own backend; LegendKeeper API keys never reach the browser.

import { useEffect, useState } from "react";

export type TokenHosting = "backend" | "owlbear";
export type Placement = "center" | "manual";

export interface Settings {
  backendUrl: string;
  accessToken: string;
  projectId: string;
  projectName: string;
  hosting: TokenHosting;
  placement: Placement;
  exportSize: 256 | 512 | 1024;
  /** Squares per side for Gargantuan creatures. */
  gargantuanCells: number;
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: "",
  accessToken: "",
  projectId: "",
  projectName: "",
  hosting: "backend",
  placement: "center",
  exportSize: 512,
  gargantuanCells: 4,
};

const KEY = "lkti.settings.v1";
const EVENT = "lkti-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(update: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...update };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked (private mode); settings then last for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return next;
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.backendUrl && s.accessToken && s.projectId);
}

/** Settings that stay current across this frame and other frames of the extension. */
export function useSettings(): Settings {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
    const onStorage = (e: StorageEvent) => e.key === KEY && refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return settings;
}

// Cross-frame navigation requests, e.g. a context menu asking the popover to open a page.
const NAV_KEY = "lkti.nav.v1";

export interface NavRequest {
  projectId: string;
  resourceId: string;
  title: string;
  at: number;
}

export function requestNavigation(req: Omit<NavRequest, "at">): void {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify({ ...req, at: Date.now() }));
  } catch {
    // Ignore; the popover simply opens on its last view.
  }
}

/** Returns and clears a navigation request made in the last few seconds. */
export function consumeNavigation(maxAgeMs = 15_000): NavRequest | null {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return null;
    localStorage.removeItem(NAV_KEY);
    const req = JSON.parse(raw) as NavRequest;
    return Date.now() - req.at <= maxAgeMs ? req : null;
  } catch {
    return null;
  }
}

export const NAV_STORAGE_KEY = NAV_KEY;
