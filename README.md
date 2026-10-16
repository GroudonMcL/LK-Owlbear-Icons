# LegendKeeper Token Importer

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension that turns art from a
[LegendKeeper](https://www.legendkeeper.com) page into a framed, ready-to-play token.
Search a page, pick an image, crop and frame it, and the token lands in the scene with
the page's title, its creature size and a persistent link back to the page.

**Nothing runs on your computer.** The extension and its small companion service are
deployed together as one free Cloudflare Worker, straight from GitHub. You add one URL to
Owlbear Rodeo and type one password.

## What it does

- **Search & images.** Search your LegendKeeper project, open a page, and see every image
  on it: sidebar images and image blocks (including those inside infoboxes, layouts,
  tables and secrets), plus the page image and the banner.
- **Linked tokens, no accidental duplicates.** Each token remembers its page by id.
  Opening a page that already has a token offers **Use existing**, **Create another** or
  **Cancel**. Copies, renamed pages, deleted tokens, tokens in other scenes, broken link
  data and failed lookups are all handled explicitly.
- **Token editor.** A large live preview with drag, wheel or pinch zoom around the
  cursor, rotation, flip, fit/fill/reset, and a dimmed view of the art outside the frame.
  There are five shapes and nine procedural frames with colour, thickness, spacing,
  backing and opacity, plus brightness/contrast/saturation and flat-background removal.
  The export comes from the same renderer as the preview.
- **Automatic size.** A `Size` field, a `Size: Large` line, or a statblock line such as
  `Large dragon, chaotic evil` sets the footprint: Tiny ½, Small/Medium 1, Large 2,
  Huge 3, Gargantuan 4 (configurable). You can always override it.
- **Placement.** Drop at the centre of your view, or click to place with a live preview.
  Right-click a linked token → **LegendKeeper page** to jump back to its page.

## Set it up (about 10 minutes, all in the browser)

You need a LegendKeeper project on a **paid plan** (API keys require it), a free
[Cloudflare](https://dash.cloudflare.com/sign-up) account, and this repository on GitHub.

1. **LegendKeeper key.** In your project: *Project Settings → Developers → API Keys →*
   create a key (the *Member* role is enough). Copy it.
2. **Cloudflare.**
   - Open *Workers & Pages* once. Cloudflare asks you to choose a `workers.dev`
     subdomain the first time.
   - Copy your **Account ID** (shown on the *Workers & Pages* overview, or in the URL of
     the dashboard).
   - *My Profile → API Tokens → Create Token →* use the **Edit Cloudflare Workers**
     template, then copy the token.
3. **Choose an access password** for the extension: at least 24 characters, from a
   password manager.
4. **GitHub secrets.** In this repository: *Settings → Secrets and variables → Actions →
   New repository secret*. Add:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the Cloudflare API token |
   | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |
   | `LK_API_KEYS` | the LegendKeeper API key (comma-separate several, one per project) |
   | `LKTI_ACCESS_TOKENS` | your access password |

5. **Deploy.** *Actions → Deploy to Cloudflare → Run workflow.* When it finishes, its
   summary shows your extension URL, e.g.
   `https://lk-token-importer.<your-subdomain>.workers.dev/manifest.json`.
6. **Owlbear Rodeo.** Open your [profile](https://owlbear.app/profile), click **Add
   Extension** and paste that URL. Enable the extension for a room, open it from the
   room's top-left toolbar, and enter your access password. Your project is selected
   automatically.

To update later, run the workflow again (it also runs on every push to `main`). Hosted
tokens are kept across deploys.

### Costs and limits

The Cloudflare free plan covers normal use: 100,000 requests per day. Finished tokens
are stored in Workers KV (1 GB and 1,000 new tokens per day on the free plan) and served
from Cloudflare's cache. LegendKeeper allows 300 API requests per minute per key. A page
open uses 1–9 of them, depending on how many documents the page has.

## How it fits together

```
 Owlbear Rodeo (GM's browser)                 Cloudflare Worker (one URL)           LegendKeeper
┌─────────────────────────────┐            ┌───────────────────────────────┐ API key ┌─────────────┐
│ popover: search, page,      │  access    │ /*.html, /assets  extension   │───────▶ │ /api/v3/... │
│   link status, image picker │─ password ▶│ /api/...          API         │         │             │
│ modal: token editor         │            │ /api/.../images   image proxy │───────▶ │ asset host  │
│ background: context menu,   │ ◀─ blob ── │ POST /api/tokens  store token │         └─────────────┘
│   click-to-place, index     │            │ GET /t/<sha256>   public, CORS│ ◀── every player's
└─────────────────────────────┘            └──────────────┬────────────────┘     browser
                                                          └── Workers KV (finished tokens)
```

LegendKeeper's API refuses requests from browser pages, and its keys must stay secret,
so a server-side piece is unavoidable. The Worker is that piece, and it also hosts the
extension. Code layout:

- **`extension/`** is the Owlbear extension (Vite + React): popover, editor modal and
  background page.
- **`server/src/core/`** is the runtime-agnostic API: Web `Request` → `Response`, Web
  Crypto and `fetch`.
- **`server/src/worker.ts`** is the Cloudflare entry, with the KV token store.
  **`server/src/node/`** is an optional self-hosting entry with a DNS-pinned fetcher and
  a file store (see `server/Dockerfile`).
- **`shared/`** holds the wire types and the size-detection rules.
- **`deploy/`** holds the GitHub Actions helpers, and **`e2e/`** the Owlbear host
  emulator and end-to-end run.

## Security

- LegendKeeper keys live only in the Worker's encrypted secrets, set by the deploy
  workflow from GitHub secrets. The extension holds the separate **access password**,
  stored in the GM's browser, and it grants only this Worker's narrow API.
- The image proxy is **page-scoped**. The browser asks for `(project, page, imageId)`,
  where `imageId` is a hash of a URL the Worker itself extracted from that page. It is
  never an open proxy. Every hop must be `https:`, and private-IP literals and local names
  are refused. Bodies are size-capped and sniffed. Set `LK_ASSET_HOSTS` (a Worker variable)
  to pin LegendKeeper's asset host.
- Private page art reaches the editor as `blob:` URLs and never gets a public URL.
- The **finished token** is the one image made public: every player's browser has to load
  it. It is published only when the GM presses *Create token*, stored under the SHA-256 of
  its bytes (unguessable, de-duplicated) and served with CORS. If you'd rather not, choose
  **Owlbear storage** in Settings. Owlbear then saves the token to your own Owlbear storage.
- Token metadata (`io.github.groudonmcl.lk-token-importer/link`) holds only the version,
  project and page ids, the last-known title, the link time and an import id.

## Token links

| Situation | Behaviour |
| --- | --- |
| First import | Token created with link metadata, selected and framed |
| Page opened again | "A token for this page already exists": *Use existing* / *Create another* / *Cancel* |
| Token deleted | Live scene lookup finds nothing; importing is open again |
| Token copied in Owlbear | Shown as multiple matches, each selectable |
| Page renamed | The link holds (by id); "Name differs" offers a one-click rename |
| Page deleted or hidden | "Page unavailable", with *Unlink tokens* |
| Token in another scene | Reported from a small room index; Owlbear has no API to switch scenes |
| Link metadata corrupted | Settings → Scene links → *Remove link data* |
| Lookup failed | Explicit warning; the picker stays closed until *Retry* or *Continue anyway* |
| Create clicked twice | One token (in-flight guard plus a per-session import id) |

## Development

```sh
npm install
npm test                 # 213 unit/integration tests (see below)
npm run typecheck
npm run build:cloudflare && npm run e2e   # end-to-end in the Workers runtime (needs Chromium)
```

- `npm test` covers size parsing, page extraction, client retries, both image fetchers'
  SSRF rules, and the full HTTP API run against **both** the Node stack and the real
  Worker entry. It also validates the mock LegendKeeper against the **official OpenAPI
  schemas** and checks that the client only calls endpoints the spec defines. The rest is
  link and room-index logic, crop geometry, pixel-level renderer checks and the deploy
  helpers.
- `npm run e2e` runs the production bundle with the real `@owlbear-rodeo/sdk`, served by
  `wrangler dev` (workerd), inside an **Owlbear host emulator** that speaks the SDK's
  message protocol from another origin. 40 checks cover the GM workflow. Screenshots go
  to `e2e/output/`.
- UI work without Owlbear: `npm run demo` (mock LegendKeeper + API on :8787) and
  `npm run dev:extension`, then open `http://localhost:5173/?mock`.

See [docs/MILESTONES.md](docs/MILESTONES.md) for per-milestone status and
[docs/API-RESEARCH.md](docs/API-RESEARCH.md) for the verified API facts behind the design.
