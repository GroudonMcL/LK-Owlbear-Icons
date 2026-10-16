// Development stand-in for Owlbear Rodeo (open a page with `?mock` on the dev
// server). The scene lives in localStorage so the popover and editor frames
// share it, which lets the full import flow run in a normal browser tab.

import type { Item } from "@owlbear-rodeo/sdk";
import type { Platform, TokenItemSpec } from "./types";

const SCENE = "lkti.mock.scene";
const SCENE_META = "lkti.mock.sceneMeta";
const ROOM_META = "lkti.mock.roomMeta";
const BUS = "lkti.mock.bus";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

function onKey(key: string, cb: () => void): () => void {
  const handler = (e: StorageEvent) => e.key === key && cb();
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function log(message: string): void {
  const el = document.getElementById("mock-log");
  if (el) el.textContent = message;
  console.info(`[mock OBR] ${message}`);
}

const params = new URLSearchParams(location.search);

export const mockPlatform: Platform = {
  kind: "mock",
  async whenReady() {},
  async getRole() {
    return params.get("role") === "player" ? "PLAYER" : "GM";
  },
  async isSceneReady() {
    return params.get("scene") !== "none";
  },
  onSceneReadyChange: () => () => {},
  async getItems() {
    if (params.get("fail") === "items") throw new Error("Mock: scene items unavailable");
    return read<Item[]>(SCENE, []);
  },
  onItemsChange(cb) {
    return onKey(SCENE, () => cb(read<Item[]>(SCENE, [])));
  },
  async addItems(items) {
    write(SCENE, [...read<Item[]>(SCENE, []), ...items]);
    log(`Added ${items.map((i) => i.name).join(", ")}`);
  },
  async updateItems(ids, update) {
    const items = read<Item[]>(SCENE, []);
    update(items.filter((i) => ids.includes(i.id)));
    write(SCENE, items);
  },
  async selectAndFocus(ids) {
    log(`Selected ${ids.join(", ")}`);
  },
  async gridDpi() {
    return 150;
  },
  async snap(position) {
    return { x: Math.round(position.x / 75) * 75, y: Math.round(position.y / 75) * 75 };
  },
  async viewportCenter() {
    return { x: 1000, y: 700 };
  },
  async getSceneMetadata() {
    return read(SCENE_META, {});
  },
  async setSceneMetadata(update) {
    write(SCENE_META, { ...read(SCENE_META, {}), ...update });
  },
  async getRoomMetadata() {
    return read(ROOM_META, {});
  },
  async setRoomMetadata(update) {
    write(ROOM_META, { ...read(ROOM_META, {}), ...update });
  },
  async notify(message, variant = "DEFAULT") {
    log(`${variant}: ${message}`);
  },
  async openEditor(query) {
    query.set("mock", "1");
    const frame = document.createElement("iframe");
    frame.id = "mock-modal";
    frame.src = `editor.html?${query}`;
    Object.assign(frame.style, {
      position: "fixed", inset: "24px", width: "calc(100vw - 48px)", height: "calc(100vh - 48px)",
      border: "0", borderRadius: "12px", background: "#2c2f3d", boxShadow: "0 20px 60px rgba(0,0,0,.6)", zIndex: "1000",
    });
    window.top!.document.body.appendChild(frame);
  },
  async closeEditor() {
    window.top!.document.getElementById("mock-modal")?.remove();
  },
  async uploadToOwlbearStorage(file) {
    const url = URL.createObjectURL(file);
    const bitmap = await createImageBitmap(file);
    const content = { url, width: bitmap.width, height: bitmap.height, mime: file.type };
    bitmap.close();
    return content;
  },
  buildTokenItem(spec: TokenItemSpec): Item {
    return {
      id: crypto.randomUUID(),
      type: "IMAGE",
      name: spec.name,
      visible: spec.visible,
      locked: false,
      createdUserId: "mock-gm",
      zIndex: Date.now(),
      lastModified: new Date().toISOString(),
      lastModifiedUserId: "mock-gm",
      position: spec.position,
      rotation: 0,
      scale: { x: 1, y: 1 },
      metadata: spec.metadata,
      layer: spec.layer,
      image: spec.image,
      grid: { dpi: spec.dpi, offset: { x: spec.image.width / 2, y: spec.image.height / 2 } },
    } as unknown as Item;
  },
  async startPlacement(request) {
    log(`Placement started for ${request.item.name}; click-to-place is simulated by adding at (0, 0).`);
    await this.addItems([{ ...request.item, position: { x: 0, y: 0 } }]);
  },
  async sendLocal(channel, data) {
    write(BUS, { channel, data, at: Date.now() });
  },
  onLocal(channel, cb) {
    return onKey(BUS, () => {
      const msg = read<{ channel: string; data: unknown } | null>(BUS, null);
      if (msg?.channel === channel) cb(msg.data);
    });
  },
  async getTheme() {
    return params.get("theme") === "light" ? { mode: "LIGHT", paper: "#f7f5f0" } : { mode: "DARK", paper: "#2a2c38" };
  },
  onThemeChange: () => () => {},
};
