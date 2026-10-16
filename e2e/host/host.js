// A minimal Owlbear Rodeo host for end-to-end tests. It speaks the real
// @owlbear-rodeo/sdk message protocol (postMessage {id, data, ref, nonce},
// answered with `${id}_RESPONSE${nonce}`), so the extension's production
// bundle runs unmodified with the real SDK inside it. It runs on a different
// origin from the extension, as Owlbear does.
//
// It is a test double, not Owlbear: behaviour is modelled on the SDK source
// and the documented limits (16 kB room metadata and broadcasts).

(() => {
  const params = new URLSearchParams(location.search);
  const EXT = params.get("ext") || "http://127.0.0.1:8787";
  const ROOM = "e2e-room";
  const USER = "gm-user";
  const SCENE_DPI = 150;
  const LIMIT = 16 * 1024;

  const state = {
    role: params.get("role") === "player" ? "PLAYER" : "GM",
    sceneReady: params.get("scene") !== "none",
    items: [],
    localItems: [],
    sceneMeta: {},
    roomMeta: {},
    selection: [],
    theme: {
      mode: "DARK",
      primary: { light: "#bbb", main: "#bb99ff", dark: "#7a5fb3", contrastText: "#000" },
      secondary: { light: "#fff", main: "#ee99ff", dark: "#a36aa8", contrastText: "#000" },
      background: { default: "#1e2130", paper: "#222639" },
      text: { primary: "#fff", secondary: "rgba(255,255,255,.7)", disabled: "rgba(255,255,255,.5)" },
    },
    contextMenus: {},
    tools: {},
    modes: {},
    activeTool: "rodeo.owlbear.tool/move",
    activeMode: null,
    modals: {},
    notifications: [],
    uploads: [],
    animatedTo: null,
    actionOpen: false,
    log: [],
    broadcasts: [],
    unhandled: [],
    errors: [],
  };

  const frames = new Map(); // ref -> { el, win, name, subs: Set, channels: Set }
  let refCounter = 0;

  function obrref() {
    return btoa(`${location.origin} ${ROOM}`);
  }

  function withRef(url) {
    const u = new URL(url, EXT);
    u.searchParams.set("obrref", obrref());
    return u.toString();
  }

  function loadFrame(name, url, el) {
    const ref = `ref-${++refCounter}`;
    el.src = withRef(url);
    const frame = { el, name, ref, subs: new Set(), channels: new Set() };
    el.addEventListener("load", () => {
      frame.win = el.contentWindow;
      frame.win.postMessage({ id: "OBR_READY", data: { ref, userId: USER } }, EXT);
    });
    frames.set(ref, frame);
    return frame;
  }

  function post(frame, id, data) {
    if (frame.win) frame.win.postMessage({ id, data }, EXT);
  }

  function emitTo(sub, id, data) {
    for (const frame of frames.values()) if (frame.subs.has(sub)) post(frame, id, data);
  }

  const itemsChanged = () => {
    emitTo("items", "OBR_SCENE_ITEMS_EVENT_CHANGE", { items: state.items });
    drawMap();
  };
  const localChanged = () => {
    emitTo("local", "OBR_SCENE_LOCAL_EVENT_CHANGE", { items: state.localItems });
    drawMap();
  };

  function toast(message, variant) {
    state.notifications.push({ message, variant });
    const div = document.createElement("div");
    div.className = variant;
    div.textContent = message;
    document.getElementById("toasts").appendChild(div);
  }

  function itemBounds(ids) {
    const list = state.items.filter((i) => ids.includes(i.id));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of list) {
      const w = i.image ? (i.image.width / i.grid.dpi) * SCENE_DPI * i.scale.x : SCENE_DPI;
      const h = i.image ? (i.image.height / i.grid.dpi) * SCENE_DPI * i.scale.y : SCENE_DPI;
      minX = Math.min(minX, i.position.x - w / 2); maxX = Math.max(maxX, i.position.x + w / 2);
      minY = Math.min(minY, i.position.y - h / 2); maxY = Math.max(maxY, i.position.y + h / 2);
    }
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY }, width: maxX - minX, height: maxY - minY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
  }

  function applyUpdates(list, updates) {
    for (const update of updates) {
      const item = list.find((i) => i.id === update.id);
      if (!item) continue;
      for (const [key, value] of Object.entries(update)) if (key !== "id" && key !== "type") item[key] = value;
    }
  }

  function size(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  function setTool(id, modeId) {
    const previousMode = state.activeMode;
    if (previousMode && state.modes[previousMode] && previousMode !== modeId) {
      const owner = state.modes[previousMode].frame;
      post(owner, "OBR_TOOL_MODE_EVENT_DEACTIVATE", { id: previousMode, context: toolContext() });
    }
    state.activeTool = id;
    state.activeMode = modeId ?? null;
    if (modeId && state.modes[modeId]) post(state.modes[modeId].frame, "OBR_TOOL_MODE_EVENT_ACTIVATE", { id: modeId, context: toolContext() });
    document.getElementById("tool").textContent = `tool: ${id}${modeId ? ` / ${modeId}` : ""}`;
  }

  function toolContext() {
    return { activeTool: state.activeTool, activeMode: state.activeMode ?? undefined, metadata: {} };
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  const handlers = {
    OBR_PLAYER_GET_ROLE: () => ({ role: state.role }),
    OBR_PLAYER_GET_ID: () => ({ id: USER }),
    OBR_PLAYER_SELECT: (_f, d) => {
      state.selection = d.replace === false ? [...state.selection, ...d.items] : d.items;
      return {};
    },
    OBR_SCENE_IS_READY: () => ({ ready: state.sceneReady }),
    OBR_SCENE_ITEMS_GET_ALL_ITEMS: () => ({ items: state.items }),
    OBR_SCENE_ITEMS_GET_ITEMS: (_f, d) => ({ items: state.items.filter((i) => d.ids.includes(i.id)) }),
    OBR_SCENE_ITEMS_ADD_ITEMS: (_f, d) => {
      state.items.push(...d.items.map((i) => ({ ...i, lastModifiedUserId: USER })));
      itemsChanged();
      return {};
    },
    OBR_SCENE_ITEMS_UPDATE_ITEMS: (_f, d) => {
      applyUpdates(state.items, d.updates);
      itemsChanged();
      return {};
    },
    OBR_SCENE_ITEMS_DELETE_ITEMS: (_f, d) => {
      state.items = state.items.filter((i) => !d.ids.includes(i.id));
      itemsChanged();
      return {};
    },
    OBR_SCENE_ITEMS_GET_ITEM_BOUNDS: (_f, d) => ({ bounds: itemBounds(d.ids) }),
    OBR_SCENE_LOCAL_GET_ALL_ITEMS: () => ({ items: state.localItems }),
    OBR_SCENE_LOCAL_ADD_ITEMS: (_f, d) => {
      state.localItems.push(...d.items);
      localChanged();
      return {};
    },
    OBR_SCENE_LOCAL_UPDATE_ITEMS: (_f, d) => {
      applyUpdates(state.localItems, d.updates);
      localChanged();
      return {};
    },
    OBR_SCENE_LOCAL_DELETE_ITEMS: (_f, d) => {
      state.localItems = state.localItems.filter((i) => !d.ids.includes(i.id));
      localChanged();
      return {};
    },
    OBR_SCENE_GET_METADATA: () => ({ metadata: state.sceneMeta }),
    OBR_SCENE_SET_METADATA: (_f, d) => {
      state.sceneMeta = { ...state.sceneMeta, ...d.update };
      emitTo("sceneMeta", "OBR_SCENE_METADATA_EVENT_CHANGE", { metadata: state.sceneMeta });
      return {};
    },
    OBR_ROOM_GET_METADATA: () => ({ metadata: state.roomMeta }),
    OBR_ROOM_SET_METADATA: (_f, d) => {
      const next = { ...state.roomMeta, ...d.update };
      if (size(next) > LIMIT) throw new Error("Room metadata is limited to 16kB");
      state.roomMeta = next;
      emitTo("roomMeta", "OBR_ROOM_METADATA_EVENT_CHANGE", { metadata: state.roomMeta });
      return {};
    },
    OBR_SCENE_GRID_GET_DPI: () => ({ dpi: SCENE_DPI }),
    OBR_SCENE_GRID_SNAP_POSITION: (_f, d) => {
      const snap = (v) => (d.useCorners ? Math.round(v / SCENE_DPI) * SCENE_DPI : Math.floor(v / SCENE_DPI) * SCENE_DPI + SCENE_DPI / 2);
      return { position: { x: snap(d.position.x), y: snap(d.position.y) } };
    },
    OBR_VIEWPORT_GET_WIDTH: () => ({ width: 1200 }),
    OBR_VIEWPORT_GET_HEIGHT: () => ({ height: 800 }),
    OBR_VIEWPORT_INVERSE_TRANSFORM_POINT: (_f, d) => ({ point: { x: d.point.x + 400, y: d.point.y + 300 } }),
    OBR_VIEWPORT_ANIMATE_TO_BOUNDS: (_f, d) => {
      state.animatedTo = d.bounds;
      return {};
    },
    OBR_THEME_GET_THEME: () => ({ theme: state.theme }),
    OBR_NOTIFICATION_SHOW: (_f, d) => {
      toast(d.message, d.variant ?? "DEFAULT");
      return { id: `n${state.notifications.length}` };
    },
    OBR_MODAL_OPEN: (_f, d) => {
      state.modals[d.id]?.el.remove();
      const el = document.createElement("iframe");
      el.className = "modal";
      el.style.width = `${Math.min(d.width ?? 800, innerWidth - 40)}px`;
      el.style.height = `${Math.min(d.height ?? 600, innerHeight - 40)}px`;
      el.dataset.modal = d.id;
      document.body.appendChild(el);
      state.modals[d.id] = loadFrame(`modal:${d.id}`, d.url, el);
      return {};
    },
    OBR_MODAL_CLOSE: (_f, d) => {
      const frame = state.modals[d.id];
      if (frame) {
        frame.el.remove();
        frames.delete(frame.ref);
        delete state.modals[d.id];
      }
      return {};
    },
    OBR_BROADCAST_SEND_MESSAGE: (from, d) => {
      if (size(d.data) > LIMIT) throw new Error("Broadcast data is limited to 16kB");
      state.broadcasts.push({ channel: d.channel, data: d.data });
      const destination = d.options?.destination ?? "REMOTE";
      // Single client: REMOTE reaches nobody; LOCAL and ALL reach this client's frames.
      if (destination === "REMOTE") return {};
      for (const frame of frames.values()) {
        if (frame.channels.has(d.channel)) post(frame, `OBR_BROADCAST_MESSAGE_${d.channel}`, { data: d.data, connectionId: "local" });
      }
      return {};
    },
    OBR_CONTEXT_MENU_CREATE: (from, d) => {
      state.contextMenus[d.id] = { frame: from, icons: d.icons };
      return {};
    },
    OBR_CONTEXT_MENU_REMOVE: (_f, d) => {
      delete state.contextMenus[d.id];
      return {};
    },
    OBR_ACTION_OPEN: () => {
      state.actionOpen = true;
      return {};
    },
    OBR_TOOL_CREATE: (from, d) => {
      state.tools[d.id] = { frame: from, def: d };
      return {};
    },
    OBR_TOOL_REMOVE: (_f, d) => {
      delete state.tools[d.id];
      return {};
    },
    OBR_TOOL_MODE_CREATE: (from, d) => {
      state.modes[d.id] = { frame: from, def: d };
      return {};
    },
    OBR_TOOL_MODE_REMOVE: (_f, d) => {
      delete state.modes[d.id];
      return {};
    },
    OBR_TOOL_GET_ACTIVE: () => ({ id: state.activeTool }),
    OBR_TOOL_ACTIVATE: (_f, d) => {
      const tool = state.tools[d.id];
      setTool(d.id, tool?.def.defaultMode ?? null);
      return {};
    },
    OBR_ASSETS_UPLOAD_IMAGES: async (_f, d) => {
      for (const upload of d.images) {
        const dataUrl = await fileToDataUrl(upload.file);
        const bitmap = await createImageBitmap(upload.file);
        state.uploads.push({ name: upload.name, grid: upload.grid, url: dataUrl, width: bitmap.width, height: bitmap.height, mime: upload.file.type });
      }
      return {};
    },
    OBR_ASSETS_DOWNLOAD_IMAGES: (_f, d) => {
      // Simulates the GM picking the image they just saved.
      const pick = [...state.uploads].reverse().find((u) => !d.defaultSearch || u.name.includes(d.defaultSearch));
      if (!pick) return { images: [] };
      return {
        images: [{ name: pick.name, image: { url: pick.url, width: pick.width, height: pick.height, mime: pick.mime }, grid: pick.grid, type: "CHARACTER" }],
      };
    },
  };

  const subscriptions = {
    OBR_SCENE_ITEMS_SUBSCRIBE: "items",
    OBR_SCENE_LOCAL_SUBSCRIBE: "local",
    OBR_SCENE_METADATA_SUBSCRIBE: "sceneMeta",
    OBR_ROOM_METADATA_SUBSCRIBE: "roomMeta",
    OBR_SCENE_READY_SUBSCRIBE: "ready",
    OBR_THEME_SUBSCRIBE: "theme",
  };

  window.addEventListener("message", async (event) => {
    if (event.origin !== EXT) return;
    const msg = event.data;
    if (!msg || typeof msg.id !== "string") return;
    const frame = frames.get(msg.ref);
    if (!frame) return;
    state.log.push({ frame: frame.name, id: msg.id });

    if (subscriptions[msg.id]) return void frame.subs.add(subscriptions[msg.id]);
    if (msg.id.endsWith("_UNSUBSCRIBE")) {
      const key = subscriptions[msg.id.replace("_UNSUBSCRIBE", "_SUBSCRIBE")];
      if (key) frame.subs.delete(key);
      if (msg.id === "OBR_BROADCAST_UNSUBSCRIBE") frame.channels.delete(msg.data.channel);
      return;
    }
    if (msg.id === "OBR_BROADCAST_SUBSCRIBE") return void frame.channels.add(msg.data.channel);

    const handler = handlers[msg.id];
    if (!handler) {
      state.unhandled.push(msg.id);
      if (msg.nonce) post(frame, `${msg.id}_RESPONSE${msg.nonce}`, {});
      return;
    }
    try {
      const result = await handler(frame, msg.data);
      if (msg.nonce) post(frame, `${msg.id}_RESPONSE${msg.nonce}`, result);
    } catch (err) {
      state.errors.push(`${msg.id}: ${err.message}`);
      if (msg.nonce) post(frame, `${msg.id}_ERROR${msg.nonce}`, { name: "Error", message: err.message });
    }
  });

  // KeyFilter evaluation as documented for context menus.
  function getPath(obj, key) {
    const path = Array.isArray(key) ? key : [key];
    return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function passes(item, filters) {
    return filters.every((f) => {
      const value = getPath(item, f.key);
      return (f.operator ?? "==") === "==" ? value === f.value : value !== f.value;
    });
  }
  function menuApplies(icon, items) {
    const f = icon.filter ?? {};
    if (f.roles && !f.roles.includes(state.role)) return false;
    if (f.min !== undefined && items.length < f.min) return false;
    if (f.max !== undefined && items.length > f.max) return false;
    if (f.every && !items.every((i) => passes(i, f.every))) return false;
    if (f.some && !items.some((i) => passes(i, f.some))) return false;
    return true;
  }

  // The scene, drawn with images loaded the way Owlbear loads them (CORS).
  const imageCache = new Map();
  function drawMap() {
    const canvas = document.getElementById("map");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e2130";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = 0.5;
    const ox = 420, oy = -100;
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    for (let x = 0; x < canvas.width; x += SCENE_DPI * scale) { ctx.beginPath(); ctx.moveTo(x + (ox % (SCENE_DPI * scale)), 0); ctx.lineTo(x + (ox % (SCENE_DPI * scale)), canvas.height); ctx.stroke(); }
    for (let y = 0; y < canvas.height; y += SCENE_DPI * scale) { ctx.beginPath(); ctx.moveTo(0, y + (oy % (SCENE_DPI * scale))); ctx.lineTo(canvas.width, y + (oy % (SCENE_DPI * scale))); ctx.stroke(); }
    for (const item of [...state.items, ...state.localItems]) {
      if (!item.image) continue;
      let img = imageCache.get(item.image.url);
      if (!img) {
        img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = drawMap;
        img.onerror = () => state.errors.push(`image failed: ${item.image.url}`);
        img.src = item.image.url;
        imageCache.set(item.image.url, img);
      }
      if (!img.complete || !img.naturalWidth) continue;
      const w = (item.image.width / item.grid.dpi) * SCENE_DPI * scale;
      const h = (item.image.height / item.grid.dpi) * SCENE_DPI * scale;
      ctx.globalAlpha = state.localItems.includes(item) ? 0.5 : 1;
      ctx.drawImage(img, ox + item.position.x * scale - w / 2, oy + item.position.y * scale - h / 2, w, h);
      ctx.globalAlpha = 1;
      if (state.selection.includes(item.id)) {
        ctx.strokeStyle = "#bb99ff";
        ctx.strokeRect(ox + item.position.x * scale - w / 2, oy + item.position.y * scale - h / 2, w, h);
      }
    }
  }

  window.host = {
    state,
    frames,
    /** Fetches the manifest cross-origin, as Owlbear does; this throws unless the host sends CORS headers. */
    async manifest() {
      try {
        const res = await fetch(`${EXT}/manifest.json`, { mode: "cors" });
        return { status: res.status, cors: true, body: await res.json() };
      } catch (err) {
        return { status: 0, cors: false, error: String(err) };
      }
    },
    async boot() {
      const manifest = (await this.manifest()).body;
      const background = document.createElement("iframe");
      background.id = "background";
      document.body.appendChild(background);
      loadFrame("background", manifest.background_url, background);
      const popover = document.createElement("iframe");
      popover.id = "popover";
      popover.style.width = `${manifest.action.width}px`;
      popover.style.height = `${manifest.action.height}px`;
      document.body.appendChild(popover);
      loadFrame("popover", manifest.action.popover, popover);
      drawMap();
      return manifest;
    },
    contextMenusFor(itemIds) {
      const items = state.items.filter((i) => itemIds.includes(i.id));
      return Object.entries(state.contextMenus)
        .filter(([, m]) => m.icons.some((icon) => menuApplies(icon, items)))
        .map(([id, m]) => ({ id, label: m.icons.find((icon) => menuApplies(icon, items)).label, icon: m.icons[0].icon }));
    },
    clickContextMenu(menuId, itemIds) {
      const items = state.items.filter((i) => itemIds.includes(i.id));
      post(state.contextMenus[menuId].frame, "OBR_CONTEXT_MENU_EVENT_CLICK", { id: menuId, context: { items, selectionBounds: itemBounds(itemIds) }, elementId: "menu" });
    },
    moveTool(x, y) {
      const mode = state.modes[state.activeMode];
      if (mode) post(mode.frame, "OBR_TOOL_MODE_EVENT_TOOL_MOVE", { id: state.activeMode, context: toolContext(), event: { pointerPosition: { x, y }, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false } });
    },
    clickTool(x, y) {
      const mode = state.modes[state.activeMode];
      if (mode) post(mode.frame, "OBR_TOOL_MODE_EVENT_TOOL_CLICK", { id: state.activeMode, context: toolContext(), event: { pointerPosition: { x, y }, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false } });
    },
    keyDown(key) {
      const mode = state.modes[state.activeMode];
      if (mode) post(mode.frame, "OBR_TOOL_MODE_EVENT_KEY_DOWN", { id: state.activeMode, context: toolContext(), event: { key, code: key, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, repeat: false } });
    },
    deleteItems(ids) {
      state.items = state.items.filter((i) => !ids.includes(i.id));
      itemsChanged();
    },
    copyItem(id) {
      const original = state.items.find((i) => i.id === id);
      state.items.push({ ...structuredClone(original), id: crypto.randomUUID(), position: { x: original.position.x + 150, y: original.position.y } });
      itemsChanged();
    },
    /** True when every token image drew into the canvas without tainting it (CORS ok). */
    mapReadable() {
      try {
        document.getElementById("map").getContext("2d").getImageData(0, 0, 1, 1);
        return true;
      } catch {
        return false;
      }
    },
    drawMap,
  };
})();
