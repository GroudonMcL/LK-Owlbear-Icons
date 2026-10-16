# LegendKeeper Token Importer

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension that turns art from a
[LegendKeeper](https://www.legendkeeper.com) page into a framed, ready-to-play token.
The GM searches a page, picks an image, crops and frames it, and the token lands in the
scene with the page's title, its creature size, and a persistent link back to the page.

- **Search & images.** Search the project, open a page, and see every image on it:
  sidebar images, image blocks (including those inside infoboxes, layouts, tables and
  secrets), the page image and the banner.
- **Linking without duplicates.** Each token stores the page's id. Opening a page that
  already has a token offers *Use existing*, *Create another* or *Cancel*. Copies,
  renamed pages, deleted tokens, tokens in other scenes and broken link data are all
  handled. A failed lookup is never treated as "no token".
- **Token editor.** A large live preview with drag, wheel or pinch zoom around the cursor,
  rotation, flip, fit/fill/reset, and a dimmed view of the art outside the frame. There
  are five shapes (circle, rounded, square, two hex orientations) and nine procedural
  frames (gilded, silver, engraved, iron-bound, arcane, infernal, double line, minimal,
  none) with colour, thickness, spacing, backing and opacity. You can also adjust
  brightness, contrast and saturation, and remove a flat background. The export *is* the
  preview: both come from one renderer.
- **Automatic size.** A `Size` key/value field, a `Size: Large` line, or a statblock line
  such as `Large dragon, chaotic evil` sets the grid footprint: Tiny ½, Small/Medium 1,
  Large 2, Huge 3, Gargantuan 4 (configurable). You can always override it.

Read [docs/API-RESEARCH.md](docs/API-RESEARCH.md) for what was verified about both APIs,
and the limitations that shaped this design.

## How it fits together

```
 Owlbear Rodeo (GM's browser)                 Your server                    LegendKeeper
┌─────────────────────────────┐   access    ┌──────────────────────┐ API key ┌──────────────┐
│ popover: search, page,      │── token ──▶ │ /api/projects        │───────▶ │ /api/v3/...  │
│   link status, image picker │             │ /api/.../search      │         │              │
│ modal: token editor         │             │ /api/.../pages/:id   │         │ asset host   │
│ background: context menu,   │ ◀─ blob ─── │ /api/.../images/:id  │───────▶ │ (images)     │
│   click-to-place, index     │             │ POST /api/tokens     │         └──────────────┘
└─────────────────────────────┘             │ GET  /t/<sha256>.png │ ◀── every player's
                                            └──────────────────────┘     browser (CORS *)
```

- **`server/`** is a zero-dependency Node service and the only place LegendKeeper keys
  live. LegendKeeper's API refuses browser origins, so a server is required anyway.
- **`extension/`** is a Vite + React app with three pages: the popover, the editor modal
  and a background page.
- **`shared/`** holds the wire types and the size-detection rules.

## Running it

### 1. Server

```sh
npm install
cp server/.env.example server/.env    # fill in LKTI_ACCESS_TOKENS and LK_API_KEYS
npm run build -w server
set -a; . server/.env; set +a; npm start -w server
```

Or with Docker (from the repo root): `docker build -f server/Dockerfile -t lk-token-importer .`,
then run it with your env vars and a volume on `/data` so hosted tokens survive restarts.

Put it behind HTTPS (Owlbear Rodeo is served over HTTPS, so browsers block
mixed-content calls to plain HTTP).

### 2. Extension

```sh
npm run build -w extension     # static files in extension/dist
```

Host `extension/dist` anywhere static (GitHub Pages, Netlify, Cloudflare Pages). In
Owlbear Rodeo, add the extension with the URL of the hosted `manifest.json`. For
development, `npm run dev:extension` serves on `http://localhost:5173`; add
`http://localhost:5173/manifest.json`.

### 3. Connect

Open the extension from the room's toolbar. Enter the server URL and one of its access
tokens, then pick the project. Settings are stored in that browser only.

### Try it without LegendKeeper or Owlbear

```sh
npm run demo            # mock LegendKeeper + the real server on :8787
npm run dev:extension   # then open http://localhost:5173/?mock
```

Use server `http://localhost:8787` and token `demo-access-token-not-for-production`.
`?mock` (dev server only) swaps Owlbear for an in-browser scene. Add `&theme=light`,
`&role=player`, `&scene=none` or `&fail=items` to see other states.

## Security model

- LegendKeeper API keys exist only in the server's environment. The extension holds a
  separate, revocable **access token** for the server. It sits in the GM's
  `localStorage` and grants only this server's narrow API.
- The image proxy is **page-scoped**. The browser asks for `(project, page, imageId)`,
  where `imageId` is a hash of a URL the server itself extracted from that page. It is
  never an open proxy. Outbound fetches are `https:` only and size-capped, and they are
  checked against private, loopback and link-local addresses *at connect time* (no DNS
  rebinding). Bytes are sniffed before use. Set `LK_ASSET_HOSTS` to pin the asset
  host(s).
- Private page art reaches the editor as `blob:` URLs. It is never given a public URL.
- The **finished token** is the one image that becomes public: every player's browser
  must load it. It is published only when the GM presses *Create token*, stored under the
  SHA-256 of its bytes (unguessable, de-duplicated), and served with
  `Access-Control-Allow-Origin: *`. If you'd rather not host anything, switch *Token
  image hosting* to **Owlbear storage**. Owlbear then asks where to save the token and
  asks you to pick it.
- Token metadata (`io.github.groudonmcl.lk-token-importer/link`) holds only the version,
  project id, page id, last-known title, link time and import id. It never holds keys or
  page content.

## Token links in Owlbear

| Situation | Behaviour |
| --- | --- |
| First import | Token created with link metadata, selected and framed in view |
| Page opened again | "A token for this page already exists": *Use existing* / *Create another* / *Cancel* |
| Token deleted | Live scene lookup finds nothing; importing is open again |
| Token copied in Owlbear | Shown as multiple matches, each selectable |
| Page renamed | Link holds (by id); "Name differs" with one-click rename |
| Page deleted or hidden | "Page unavailable", with *Unlink tokens* |
| Token in another scene | Reported from the room index; Owlbear has no API to switch scenes |
| Link metadata corrupted | Listed in Settings → Scene links, with *Remove link data* |
| Lookup failed (network, scene) | Explicit warning; picker stays closed until *Retry* or *Continue anyway* |
| Create clicked twice | One token: in-flight guard plus a per-session import id checked against the scene |

Right-click a linked token → **LegendKeeper page** to open it in the importer.

## Development

```sh
npm test            # 156 tests: size parsing, extraction, client retries, SSRF guard,
                    # HTTP integration against a mock LegendKeeper, link/index logic,
                    # crop geometry and pixel-level renderer checks
npm run typecheck
npm run build
```

## Verified vs. unverified

Verified with a mock LegendKeeper built from the v3 OpenAPI spec, and by driving the real
UI in headless Chromium through the mock Owlbear platform. **Not yet exercised against a
live LegendKeeper project or a live Owlbear room** (that needs a paid LegendKeeper key and
a room). The calls follow the documented API and SDK types. See the open items at the end
of [docs/API-RESEARCH.md](docs/API-RESEARCH.md).
