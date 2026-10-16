import OBR, { buildImage, buildImageUpload, type Item } from "@owlbear-rodeo/sdk";
import { CH_PLACE, EDITOR_MODAL_ID, extensionUrl } from "./channels";
import type { Platform, PlacementRequest, TokenItemSpec } from "./types";

export const obrPlatform: Platform = {
  kind: "owlbear",

  whenReady() {
    return new Promise((resolve) => (OBR.isReady ? resolve() : OBR.onReady(() => resolve())));
  },
  getRole: () => OBR.player.getRole(),
  isSceneReady: () => OBR.scene.isReady(),
  onSceneReadyChange: (cb) => OBR.scene.onReadyChange(cb),
  getItems: () => OBR.scene.items.getItems(),
  onItemsChange: (cb) => OBR.scene.items.onChange(cb),
  addItems: (items) => OBR.scene.items.addItems(items),
  updateItems: (ids, update) => OBR.scene.items.updateItems(ids, (drafts) => update(drafts as Item[])),

  async selectAndFocus(ids) {
    if (ids.length === 0) return;
    await OBR.player.select(ids, true);
    const bounds = await OBR.scene.items.getItemBounds(ids);
    const pad = Math.max(bounds.width, bounds.height) * 1.5 + 150;
    await OBR.viewport.animateToBounds({
      min: { x: bounds.min.x - pad, y: bounds.min.y - pad },
      max: { x: bounds.max.x + pad, y: bounds.max.y + pad },
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
      center: bounds.center,
    });
  },

  gridDpi: () => OBR.scene.grid.getDpi(),

  async snap(position, cells) {
    // Odd footprints centre on a square; even footprints centre on a grid corner.
    const even = Number.isInteger(cells) && cells % 2 === 0;
    return OBR.scene.grid.snapPosition(position, 1, even, !even);
  },

  async viewportCenter() {
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
  },

  getSceneMetadata: () => OBR.scene.getMetadata(),
  setSceneMetadata: (update) => OBR.scene.setMetadata(update),
  getRoomMetadata: () => OBR.room.getMetadata(),
  setRoomMetadata: (update) => OBR.room.setMetadata(update),

  async notify(message, variant = "DEFAULT") {
    await OBR.notification.show(message, variant);
  },

  openEditor: (query) =>
    OBR.modal.open({ id: EDITOR_MODAL_ID, url: `${extensionUrl("editor.html")}?${query}`, width: 1120, height: 760 }),
  closeEditor: () => OBR.modal.close(EDITOR_MODAL_ID),

  async uploadToOwlbearStorage(file, name, dpi) {
    const upload = buildImageUpload(file).name(name).dpi(dpi).build();
    await OBR.assets.uploadImages([upload], "CHARACTER");
    const picked = await OBR.assets.downloadImages(false, name, "CHARACTER");
    return picked[0]?.image ?? null;
  },

  buildTokenItem(spec: TokenItemSpec) {
    let builder = buildImage(spec.image, { dpi: spec.dpi, offset: { x: spec.image.width / 2, y: spec.image.height / 2 } })
      .name(spec.name)
      .position(spec.position)
      .layer(spec.layer)
      .visible(spec.visible)
      .metadata(spec.metadata);
    if (spec.showLabel) builder = builder.plainText(spec.name).textItemType("LABEL");
    return builder.build();
  },

  startPlacement: (request: PlacementRequest) => OBR.broadcast.sendMessage(CH_PLACE, request, { destination: "LOCAL" }),
  sendLocal: (channel, data) => OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" }),
  onLocal: (channel, cb) => OBR.broadcast.onMessage(channel, (event) => cb(event.data)),

  async getTheme() {
    const theme = await OBR.theme.getTheme();
    return { mode: theme.mode, paper: theme.background.paper };
  },
  onThemeChange: (cb) => OBR.theme.onChange((theme) => cb({ mode: theme.mode, paper: theme.background.paper })),
};
