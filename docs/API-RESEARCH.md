# API research and limitations

This document records what was verified about the LegendKeeper and Owlbear Rodeo
APIs before building, and the design decisions each fact forced. Facts were
checked on 2026-10-16 against:

- LegendKeeper OpenAPI spec `https://www.legendkeeper.com/api/v3/openapi.json` (v3.0.0),
  the developer guide/quickstart, and the `@legendkeeper/sdk@4.1.0` package's `GUIDE.md`.
- Live probes of `https://www.legendkeeper.com/api/v3/*` (unauthenticated).
- `@owlbear-rodeo/sdk@3.1.0` type definitions and the docs at `docs.owlbear.rodeo/extensions`.

Anything marked **unverified** could not be confirmed without a paid LegendKeeper
API key and is handled defensively.

## LegendKeeper

### Authentication and projects

| Fact | Source |
| --- | --- |
| Auth is `Authorization: Bearer <project API key>`. Keys are created in *Project Settings → Developers → API Keys*. | OpenAPI `securitySchemes.bearerAuth` |
| A key works **only in its own project**; naming another project answers `403 WRONG_PROJECT`. `GET /api/v3/projects` with a key returns just that project. | OpenAPI `listProjects`, `bearerAuth` |
| Keys require the project owner to be on a paid plan (`402 PAID_PLAN_REQUIRED`). | OpenAPI error table |
| A key acts with the lower of its role (`MEMBER`/`ADMIN`) and its creator's role. Non-admins don't see hidden documents, hidden properties or secret blocks. | OpenAPI, quickstart |
| "The API does not accept requests from browser pages on other sites." A probe confirms it: `OPTIONS` preflight → `405`, and no response carries `Access-Control-Allow-Origin`. | Quickstart; live probe |
| Unslashed paths answer `308` to the trailing-slash form (e.g. `/api/v3/projects` → `/api/v3/projects/`). | Live probe |
| Rate limits per key: 300 req/min, 6,000/h, 60,000/day; 12,000/h per project. `429` carries `Retry-After`. | OpenAPI description |

**Consequence:** a server-side component is mandatory, for CORS as well as for key
secrecy. It is deployed as a Cloudflare Worker that also hosts the extension, so nothing
runs on the GM's computer.
"Selecting a project" means choosing among the projects whose keys the backend
holds. One key covers exactly one project, so the backend accepts several keys.

### Search and page retrieval

- `GET /projects/{id}/search?q=&limit=` (limit 1–100, default 32) matches name, aliases and
  content, best match first. It returns **one page only (no pagination)**. A resource can
  appear once per matching document, so results must be de-duplicated by resource id.
  Each hit carries `resource {id, name, tags, path[], iconGlyph, iconColor}` and an optional
  `document {name, highlights[]}` with the matched passage.
- `GET /projects/{id}/resources/{rid}` returns the resource with `documents[]` (summaries with
  `type: page|board|map|time|blank`), sidebar `properties[]`, `tags`, `aliases`, `imageUrl`
  and `banner {enabled,url}`. A resource the caller can't reach returns `404`.
- `GET .../docs/{docId}/blocks` returns the page as a typed block tree, plus `text` (plain
  text, one line per text-bearing block).

### How images are represented

There are no image IDs in content. Images are **URLs of project image assets**:

| Location | Shape |
| --- | --- |
| Image block anywhere in a page tree, including inside layouts, tables, callouts, expands, secrets, text fields and **infobox rows** | `{ kind: "image", url, alt?, title?, isTitleHidden? }` |
| Sidebar image property | `{ kind: "image", url, title?, ... }` in `resource.properties` |
| Resource banner | `resource.banner.url` |
| Resource image | `resource.imageUrl` |

- `GET /assets/{assetId}` returns `url`, `width`, `height`, but nothing maps a content URL
  back to an asset id. Image dimensions are therefore learned client-side once the
  image is loaded.
- Asset URLs are documented only as "always on a LegendKeeper asset host". **Unverified:**
  the host name, whether these URLs need authentication, and whether they send CORS
  headers. Legacy content may also hold hot-linked external URLs: the spec says a URL
  "already held" in a document is accepted again on write.
- Formats: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

**Consequence:** images are fetched by the backend through an image proxy that is
**page-scoped**. The client asks for `(project, page, imageId)`, where `imageId` is a hash
of a URL the backend itself extracted from that page. Arbitrary URLs are never
accepted. Outbound fetches are `https:` only, and every resolved address is checked
against private, loopback and link-local ranges at connect time (no DNS-rebinding
window). Responses are size-capped and magic-byte sniffed. The LegendKeeper key is
never sent to the asset host. If the asset host turns out to require auth, the proxy
reports `IMAGE_UNAVAILABLE` per image rather than failing the page. An optional
`LK_ASSET_HOSTS` allowlist can tighten this once the host is known.

The extension receives proxied images as `blob:` URLs, which keeps the editor canvas
untainted and means private images never get a public URL.

### Structured data and "Size"

- Key/value data lives in three places with one row shape `{ key, text, content[] }`:
  sidebar `keyValue` properties, `keyValue` blocks, and `keyValue` properties inside
  `infobox` blocks.
- Statblocks have no dedicated type. They are text, tables or key/value blocks.

**Size detection order** (first hit wins; prose is never scanned for a bare word):

1. A key/value row whose key normalises to `size` (sidebar, infobox or block).
2. A text line that *starts* with `Size:` / `Size -`.
3. A D&D statblock type line that starts with a size, followed by a creature type, then
   a comma and an alignment (e.g. `Large dragon, chaotic evil`, `Medium or Small Humanoid, Neutral`).

### Tags

Tags are on every resource (`tags[]`). `GET /projects/{id}/tags` lists them with counts.

## Owlbear Rodeo

| Fact | Source |
| --- | --- |
| An extension is a `manifest.json` with an `action` (popover URL, max width/height) and an optional `background_url`. | docs: manifest |
| `ImageContent.url` "must have CORS enabled". `ImageContent` has `width`, `height`, `mime`, `url`. | docs: items/image |
| An image's size on the map is `image.width / grid.dpi` grid cells (times `scale`). `grid.offset` is the anchor point in image pixels. | `ImageGrid` docs + SDK types |
| `OBR.assets.uploadImages(images, typeHint)` "opens a folder picker" and returns `void`: **no URL comes back** and nothing is added to the scene. `downloadImages(multiple, defaultSearch, typeHint)` opens the image picker and returns `ImageDownload` with an Owlbear-hosted `ImageContent`. | docs: assets |
| Metadata on items, scenes, rooms and players is shared with other extensions; keys should be reverse-domain namespaced. Room metadata totals **under 16 kB**. Broadcast payloads are ≤ 16 kB. | docs: metadata, room, broadcast |
| `OBR.scene.items.getItems(filter)` only sees the **currently open scene**. No API lists other scenes or their items, and no API switches scenes. | SDK types (`SceneApi`) |
| `OBR.player.select(ids)` selects items. `OBR.viewport.animateToBounds(bounds)` with `getItemBounds(ids)` frames them. | SDK types |
| `OBR.viewport.inverseTransformPoint` maps screen → scene coordinates. `OBR.scene.grid.snapPosition` snaps. | docs: viewport, grid |
| Context menu icons take `filter.every/some` `KeyFilter`s whose `key` may be a path array (e.g. `["metadata", "<ns>/link"]`), and `roles: ["GM"]`. | SDK `KeyFilter`, `ContextMenuIconFilter` |
| Tool modes receive `onToolClick` with `pointerPosition` in scene space and can be created and removed at runtime. | docs: tool |
| `OBR.modal.open({ url, width, height, fullScreen })` provides a large surface. Popovers are size-capped by the manifest. | docs: modal |

### Decisions forced by these facts

1. **Token image hosting.** No Owlbear API takes a generated image and returns a URL
   without user interaction. Two supported modes are implemented:
   - **Worker hosting (default, direct).** The final PNG is posted to the Worker. It is
     stored in Workers KV under its SHA-256 (de-duplicated, immutable) and served with
     `Access-Control-Allow-Origin: *` from the edge cache. This is the only image the
     extension ever makes publicly reachable, and only when the GM presses *Create token*.
     Every player's browser must be able to load a token anyway. The URL is unguessable
     (content hash).
   - **Owlbear storage.** The token goes to the GM's Owlbear library via `uploadImages`
     (folder picker). `downloadImages` (image picker, pre-filtered by name) then returns
     the Owlbear-hosted URL, and the item is built from it with link metadata attached.
     This needs no backend storage but costs two clicks in Owlbear dialogs.

   A `data:` URL in the item was rejected. It would put hundreds of kB into every
   scene sync, and Owlbear documents no size guarantee for item payloads.

2. **Grid footprint.** `grid.dpi = exportSize / cells`, with `scale = 1`. Tiny (0.5 cells)
   therefore works natively, and Owlbear's own resize handles keep working.

3. **Cross-scene duplicates.** Only the open scene can be inspected. The extension keeps a
   small **room-level index** (`resourceKey → sceneKeys[]`, capped well under 16 kB) and
   tags each scene with a random scene key in scene metadata. While a scene is open, its
   index entries are reconciled against the actual items. That corrects deletions and
   copies, and the index never stands in for a live lookup. A token in another scene is
   reported as such, without a navigation offer, because no API supports one.

4. **Players.** Import UI and context menus are GM-only (`roles: ["GM"]` and
   `OBR.player.getRole()`).

## Facts established while testing (2026-10-16)

| Fact | How it was established |
| --- | --- |
| Every LegendKeeper v3 route is canonical with a trailing slash; the unslashed form answers `308` to it (query preserved). The client requests the slashed form directly. | Live probes of `/search`, `/resources/{id}`, `/docs/{id}/blocks` |
| The SDK locates its host from an `obrref` query parameter, `base64("<origin> <roomId>")`, which Owlbear appends to every extension frame URL. It accepts messages only from that origin. `OBR.isAvailable` is `Boolean(origin)`. | `@owlbear-rodeo/sdk/lib/common/getDetails.js`, `messages/MessageBus.js` |
| The SDK makes relative icon and modal URLs absolute against `window.location.origin` (not the manifest's directory), so the extension passes absolute URLs. | `lib/common/normalize.js` |
| `updateItems` sends whole top-level fields computed from Immer patches; deleting one metadata key sends the full new `metadata` object. | `lib/api/scene/SceneItemsApi.js` |
| In Cloudflare Workers, calling the global `fetch` as a method (`this.fetch(...)`) throws "Illegal invocation"; Node does not. | Reproduced in `workerd`; regression test in `client.test.ts` |
| Workers Static Assets redirects `/x.html` to `/x` by default (`html_handling: auto-trailing-slash`), and adds no CORS headers. Both are configured (`html_handling: none`, `_headers`) so Owlbear can fetch the manifest and open the exact page URLs. | `wrangler dev` |
| Owlbear install: profile → **Add Extension** with the manifest URL, then enable it for a room. | docs: tutorial "Install your extension" |

## Remaining unverified items (need a real key)

- LegendKeeper asset host name, and whether asset URLs need cookies or tokens or send CORS
  headers. Handled by the proxy either way. Set `LK_ASSET_HOSTS` once known.
- Whether LegendKeeper's edge (itself behind Cloudflare) treats requests from Cloudflare
  Workers differently from other server-side clients. Plain server requests are answered
  normally (verified with curl).
- `Resource.imageUrl` semantics (it is undocumented beyond its type). Included as a
  candidate image labelled "Page image".
