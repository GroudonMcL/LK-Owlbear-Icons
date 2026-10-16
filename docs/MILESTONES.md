# Milestones

Status of each milestone in the implementation plan: what was built, how it was tested,
known limitations and outstanding work.

**What "tested" means here.**
- *LegendKeeper:* tested against a mock built from LegendKeeper's v3 OpenAPI spec. Every
  mock response is validated against the official schemas, and every request the client
  makes must match a path the spec defines (`server/test/spec.test.ts`).
- *Owlbear:* tested with the real `@owlbear-rodeo/sdk` 3.1.0 in the production bundle,
  inside a host emulator that implements the SDK's message protocol (`e2e/`).
- *Cloudflare:* tested in the real Workers runtime (`workerd`, via `wrangler dev`).
- *Not yet done:* a run against a live LegendKeeper project (needs a paid API key) or a
  live Owlbear Rodeo room. Those are the first things to check after deploying; see
  "Outstanding" in Milestone 5.

## Milestone 1: Connectivity and search

**Implemented**
- The Cloudflare Worker holds the LegendKeeper keys (one per project) and exposes
  `/api/projects`, `/api/projects/:id/search` and `/api/projects/:id/pages/:id`.
- Projects are resolved from each key (`GET /api/v3/projects/` returns the key's project);
  a single project is selected automatically.
- Search is debounced (250 ms), cancels stale requests, and de-duplicates resources (the
  API returns one hit per matching document). Results show breadcrumbs, the matched
  snippet, tags and an on-map badge, plus a recent-pages list. Results are cached for
  30 s on the server and 2 min in the browser.
- Page extraction walks the whole block tree: sidebar image properties, image blocks
  inside infoboxes, layouts, tables, callouts, secrets and text fields, the page image
  and the banner. Duplicates are collapsed. Each image gets an opaque id; asset URLs never
  leave the server.
- Requests use LegendKeeper's canonical trailing-slash routes (verified live: unslashed
  routes answer 308). Retries cover 429 with `Retry-After` and 5xx. Errors are mapped to
  actionable messages (e.g. "API keys need the project owner to be on a paid plan").

**Tests run.** Extraction (9), client retries and timeouts (7), spec conformance (14),
and API integration on Node and on the Worker (47). The e2e checks cover connecting with
a bad and then a good password, search, page images and the detected size.

**Known limitations**
- LegendKeeper search returns a single page of results (≤ 100, the API has no cursor).
  The UI says when the limit was reached.
- Only `page` documents are scanned. Maps, boards and timelines are skipped, so their
  art isn't offered as token art.

**Outstanding.** None for this milestone.

## Milestone 2: Basic token creation

**Implemented**
- An image is picked from the page and a token created with the page title as its name, on
  the Character layer (Mount and Prop are available).
- Footprint is set through `grid.dpi = imageWidth / cells`, which is Owlbear's own
  scaling model. Tiny (½ square) works natively.
- Placement is either the snapped viewport centre (corner-snapped for even footprints) or
  click to place (a temporary tool mode with a ghost preview; Esc cancels).
- Hosting is either Worker KV (content-addressed, CORS, edge-cached) or the GM's Owlbear
  storage (`uploadImages` then `downloadImages`). An orphaned image is deleted from KV and
  the edge cache when a placement is cancelled or fails.

**Tests run.** E2e checks: name, layer, `grid.dpi` and anchor; snapped placement; one token
after a double-click; the hosted image is CORS-loadable into a canvas on another origin;
click-to-place, ghost and tool restore; cancel deletes the image; the Owlbear-storage path
carries the upload dpi; broadcast payload under 16 kB.

**Known limitations**
- Owlbear-storage hosting shows two Owlbear dialogs: save, then pick. The SDK has no
  silent upload that returns a URL.
- Hosted tokens are never garbage-collected from KV. On the free plan there's room for
  thousands. Remove old ones from the Cloudflare dashboard if needed.

**Outstanding.** None for this milestone.

## Milestone 3: Token editor

**Implemented**
- One renderer for preview and export: five shapes, nine procedural frames, border colour
  and thickness, outer and inner spacing, backing colour and opacity (or transparent),
  frame opacity.
- Crop: drag, wheel or pinch zoom around the cursor, keyboard nudge, rotation, flip,
  Fit / Fill / Reset, and lock-to-frame. That last one is an exact constraint (the
  rotated image must contain every vertex of the frame), so locked crops never show empty
  corners.
- A dimmed overflow view shows the art outside the frame. Frame presets preview with the
  user's own image.
- Brightness, contrast, saturation and flat-background removal are computed on a capped
  2048 px working copy, off the drag path.
- PNG export at 256, 512 or 1024 px with transparency outside the shape. Settings are
  remembered between imports.

**Tests run.** 37 editor tests:
- Shapes and insets, and perimeter sampling.
- Coverage under 200 random drags/zooms for portrait, landscape, panorama and rotated
  cases, checked analytically and in pixels.
- Transparency outside every shape.
- Export ≡ preview: the same render at 128 px and at 512 px downscaled agrees within
  resampling noise.
- Every frame on every shape, padding/backing, background removal and adjustments.
- Visual review of screenshots at desktop and narrow widths, dark and light.

**Known limitations**
- Animated GIFs import as their first frame.
- Background removal suits flat, edge-connected backgrounds, not painted ones.

**Outstanding.** None for this milestone.

## Milestone 4: Size detection and duplicate prevention

**Implemented**
- Size detection runs in priority order: a key/value row keyed "Size" (sidebar, infobox,
  key/value block or two-cell table row), then a `Size:` line, then a statblock type line.
  It never takes a size word from prose. The GM can always override, and Gargantuan's
  footprint is configurable.
- Each token's link is stored in namespaced metadata: version, project id, page id,
  title, link time and import id. Matching is by id only, and invalid metadata is
  reported separately.
- Duplicates are checked live in the open scene. Copies, renamed pages (one-click rename),
  pages that are no longer accessible (unlink) and failed lookups (explicit warning, never
  read as "none") are all handled.
- The editor re-checks at create time, and the popover's "Create another" carries through.
- The room index (kept under 16 kB) lets a page report tokens in other scenes.
  The background page reconciles it against the open scene's real items, so deletions
  correct themselves.
- A context menu on linked tokens opens the page in the importer.

**Tests run.**
- Size parsing (38), including prose false positives.
- Links and room index (16), including budget eviction and defensive parsing.
- E2e checks: detection on re-open, *Use existing* selects, the context-menu filter and its
  navigation, a copy reported as a second match, deletion re-opens import, the index records
  and then forgets entries, room metadata under 16 kB, and players get no import UI.

**Known limitations**
- Other scenes are known only from the index. Owlbear extensions can't read or open
  another scene, so the extension reports "in another scene" without a link.
- A token copied *between rooms* keeps its link, but the new room's index learns about it
  only once its scene is open.

**Outstanding.** None for this milestone.

## Milestone 5: Polish and hardening

**Implemented**
- Browser-only deployment: a single Cloudflare Worker serves the extension, API and
  tokens, deployed by a GitHub Actions workflow from repository secrets. The KV namespace
  is found or created by name, so redeploys keep tokens.
- Owlbear can fetch the manifest cross-origin (`_headers`).
- Errors are explicit, with retries everywhere a call can fail. Loading skeletons, dimmed
  stale results and keyboard navigation are in place. Light/dark follows Owlbear.
- The UI works at narrow widths. Request concurrency is limited for thumbnails, with LRU
  caches on the server.
- Defects found and fixed by testing in the real runtimes:
  - The Workers `fetch` "Illegal invocation" (now covered by a regression test).
  - Static-asset HTML redirects.
  - Manifest CORS.
  - The overflow canvas sizing.
  - The double search-clear button.
  - Stale search results that looked clickable.

**Tests run.**
- `npm test`: 213 tests across 9 files.
- `npm run e2e`: 40 checks, run in the Workers runtime.
- The deploy helpers, against a mock Cloudflare API: namespace reuse and actionable errors
  for a missing subdomain, a bad token and missing secrets.
- CI (`.github/workflows/ci.yml`) runs all of the above on every push.

**Known limitations**
- The importer is built for one GM per deployment. Several GMs can share it by sharing the
  access password, or by listing several passwords in `LKTI_ACCESS_TOKENS`.
- LegendKeeper's asset host is undocumented. Images are fetched without the API key; if
  the asset host turns out to require authentication, those images show "couldn't be
  downloaded" while the rest of the importer keeps working.

**Outstanding (needs your accounts)**
1. Run the deploy workflow and import one token in a real room, to confirm against the live
   LegendKeeper API and live Owlbear Rodeo. Check in particular that the page images load,
   which shows LegendKeeper's asset host is reachable without auth.
2. Optionally set the `LK_ASSET_HOSTS` Worker variable to the host seen in your page image
   URLs, to pin the image proxy to it.
