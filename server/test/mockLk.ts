// A stand-in for the LegendKeeper v3 API and its asset host, shaped after the
// OpenAPI spec, for integration tests and local UI development.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { createCanvas } from "@napi-rs/canvas";

export const PROJECT_ID = "proj_test01";
export const API_KEY = "lk_test_key_do_not_leak_0123456789";

export function makePng(width: number, height: number, color = "#b0413e"): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f3d27a";
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}

/** Procedural portrait-style art: sky gradient, a hooded figure, optional plain background. */
export function makeArt(width: number, height: number, hue: number, plainBackground = false): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (plainBackground) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, `hsl(${hue}, 45%, 22%)`);
    sky.addColorStop(0.6, `hsl(${(hue + 30) % 360}, 50%, 38%)`);
    sky.addColorStop(1, `hsl(${(hue + 50) % 360}, 55%, 52%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255, 255, 230, ${0.2 + ((i * 37) % 10) / 20})`;
      ctx.beginPath();
      ctx.arc(((i * 97) % 100) / 100 * width, ((i * 53) % 45) / 100 * height, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const u = Math.min(width, height);
  const cx = width / 2;
  const cy = height * 0.42;
  // Cloak and shoulders.
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 30%, 18%)`;
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.42, height);
  ctx.quadraticCurveTo(cx - u * 0.38, cy + u * 0.18, cx, cy - u * 0.28);
  ctx.quadraticCurveTo(cx + u * 0.38, cy + u * 0.18, cx + u * 0.42, height);
  ctx.closePath();
  ctx.fill();
  // Face in the hood.
  ctx.fillStyle = `hsl(${(hue + 20) % 360}, 35%, 62%)`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, u * 0.12, u * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glowing eyes.
  ctx.fillStyle = `hsl(${(hue + 160) % 360}, 90%, 70%)`;
  for (const dx of [-0.045, 0.045]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * u, cy - u * 0.02, u * 0.022, u * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Staff.
  ctx.strokeStyle = `hsl(${(hue + 40) % 360}, 40%, 40%)`;
  ctx.lineWidth = u * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx + u * 0.3, height);
  ctx.lineTo(cx + u * 0.34, cy - u * 0.3);
  ctx.stroke();
  ctx.fillStyle = `hsl(${(hue + 160) % 360}, 90%, 65%)`;
  ctx.beginPath();
  ctx.arc(cx + u * 0.34, cy - u * 0.33, u * 0.04, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}

export interface MockLk {
  baseUrl: string;
  assetBase: string;
  /** Requests seen, as "METHOD path". */
  requests: string[];
  /** Override: respond to the next N calls of a path prefix with a status. */
  failNext(pathPrefix: string, status: number, code: string, times?: number, headers?: Record<string, string>): void;
  close(): Promise<void>;
}

function runs(text: string) {
  return [{ text }];
}

export function buildFixtures(assetBase: string) {
  const resources: Record<string, unknown> = {
    goblin: {
      id: "goblin",
      name: "Goblin Boss",
      tags: ["monster", "goblinoid"],
      aliases: ["Boss"],
      rank: "a0",
      isHidden: false,
      permissions: {},
      imageUrl: `${assetBase}/assets/goblin-icon.png`,
      banner: { enabled: true, url: `${assetBase}/assets/goblin-banner.png`, yPosition: 50 },
      documents: [
        { id: "doc1", name: "Overview", type: "page", rank: "a0", isHidden: false },
        { id: "doc2", name: "Lair map", type: "map", rank: "a1", isHidden: false },
        { id: "doc3", name: "Broken", type: "page", rank: "a2", isHidden: false },
      ],
      properties: [
        { id: "p1", kind: "image", url: `${assetBase}/assets/goblin-portrait.png`, title: "Portrait" },
        {
          id: "p2",
          kind: "keyValue",
          title: "Stats",
          rows: [
            { id: "r1", rank: "a0", key: "Type", text: "Humanoid", content: runs("Humanoid") },
            { id: "r2", rank: "a1", key: "Size", text: "Small", content: runs("Small") },
          ],
        },
      ],
      updatedAt: "2026-10-01T10:00:00Z",
    },
    dragon: {
      id: "dragon",
      name: "Ancient Red Dragon",
      tags: ["monster"],
      aliases: [],
      rank: "a1",
      isHidden: false,
      permissions: {},
      documents: [{ id: "d1", name: "Statblock", type: "page", rank: "a0", isHidden: false }],
      properties: [],
    },
    village: {
      id: "village",
      name: "Millbrook",
      tags: ["location"],
      aliases: [],
      rank: "a2",
      isHidden: false,
      permissions: {},
      documents: [{ id: "v1", name: "Main", type: "page", rank: "a0", isHidden: false }],
      properties: [],
    },
    missingimg: {
      id: "missingimg",
      name: "Lost Portrait",
      tags: [],
      aliases: [],
      rank: "a3",
      isHidden: false,
      permissions: {},
      documents: [{ id: "m1", name: "Main", type: "page", rank: "a0", isHidden: false }],
      properties: [{ id: "x", kind: "image", url: `${assetBase}/assets/does-not-exist.png`, title: "Gone" }],
    },
  };

  const blocks: Record<string, unknown[]> = {
    "goblin/doc1": [
      { id: "b1", kind: "heading", level: 1, content: runs("Goblin Boss") },
      {
        id: "b2",
        kind: "infobox",
        rows: [{ id: "ib1", kind: "image", url: `${assetBase}/assets/goblin-infobox.png`, title: "Image" }],
      },
      {
        id: "b3",
        kind: "layout",
        children: [
          {
            id: "b4",
            kind: "layoutColumn",
            children: [
              { id: "b5", kind: "image", url: `${assetBase}/assets/goblin-portrait.png`, title: "Duplicate" },
              { id: "b6", kind: "image", url: `${assetBase}/assets/goblin-action.png`, alt: "Goblin attacking" },
            ],
          },
        ],
      },
      { id: "b7", kind: "paragraph", content: runs("A large goblin, chaotic and cruel, leads the warband.") },
    ],
    "dragon/d1": [
      { id: "s1", kind: "paragraph", content: runs("Gargantuan dragon, chaotic evil") },
      {
        id: "s2",
        kind: "secret",
        children: [{ id: "s3", kind: "image", url: `${assetBase}/assets/dragon.jpg`, title: "Red dragon art" }],
      },
    ],
    "village/v1": [{ id: "v", kind: "paragraph", content: runs("A large village by the river.") }],
    "missingimg/m1": [],
  };

  return { resources, blocks };
}

export async function startMockLk(): Promise<MockLk> {
  const requests: string[] = [];
  const failures: { prefix: string; status: number; code: string; times: number; headers: Record<string, string> }[] = [];
  const pngs: Record<string, Buffer> = {
    "goblin-icon.png": makeArt(64, 64, 110),
    "goblin-banner.png": makeArt(800, 200, 220),
    "goblin-portrait.png": makeArt(600, 800, 20),
    "goblin-infobox.png": makeArt(512, 512, 280),
    "goblin-action.png": makeArt(900, 600, 0, true),
  };
  // A JPEG would need an encoder; serve PNG bytes under a .jpg name to prove sniffing ignores names.
  pngs["dragon.jpg"] = makeArt(1200, 900, 350);

  let assetBase = "";
  let fixtures: ReturnType<typeof buildFixtures>;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const pathname = url.pathname.replace(/\/$/, "");
    requests.push(`${req.method} ${pathname}`);

    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", "x-request-id": "req_mock", ...headers });
      res.end(JSON.stringify(body));
    };

    if (pathname.startsWith("/assets/")) {
      const png = pngs[pathname.slice("/assets/".length)];
      if (!png) return json(404, { message: "Not found" });
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": png.length });
      return void res.end(png);
    }

    const failure = failures.find((f) => pathname.startsWith(f.prefix) && f.times > 0);
    if (failure) {
      failure.times -= 1;
      return json(failure.status, { message: "Mock failure", code: failure.code, requestId: "req_fail" }, failure.headers);
    }

    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      return json(401, { message: "Unauthenticated", code: "UNAUTHENTICATED", requestId: "req_401" });
    }

    if (pathname === "/api/v3/projects") {
      return json(200, { data: [{ id: PROJECT_ID, name: "The Test Realm", isPublic: false }], hasMore: false, nextCursor: null });
    }

    const base = `/api/v3/projects/${PROJECT_ID}`;
    if (!pathname.startsWith(base)) return json(403, { message: "Wrong project", code: "WRONG_PROJECT", requestId: "r" });
    const rest = pathname.slice(base.length);

    if (rest === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number(url.searchParams.get("limit") ?? 32);
      const data: unknown[] = [];
      for (const r of Object.values(fixtures.resources) as { id: string; name: string; tags: string[] }[]) {
        if (r.name.toLowerCase().includes(q)) {
          data.push({ resource: { id: r.id, name: r.name, tags: r.tags, path: [{ id: "root", name: "Bestiary" }] } });
          // A second hit for the same resource, matching in a document.
          data.push({
            resource: { id: r.id, name: r.name, tags: r.tags },
            document: {
              id: "doc",
              name: "Overview",
              highlights: [{ segment: `About ${r.name} and friends`, index: 0, matchStart: 6, matchEnd: 6 + r.name.length }],
            },
          });
        }
      }
      return json(200, { data: data.slice(0, limit), hasMore: false, nextCursor: null });
    }

    const resMatch = /^\/resources\/([^/]+)(?:\/docs\/([^/]+)\/blocks)?$/.exec(rest);
    if (resMatch) {
      const [, rid, docId] = resMatch;
      const resource = fixtures.resources[rid];
      if (!resource) return json(404, { message: "Not found", code: "NOT_FOUND", requestId: "r404" });
      if (!docId) return json(200, resource);
      const content = fixtures.blocks[`${rid}/${docId}`];
      if (!content) return json(500, { message: "Internal", code: "INTERNAL", requestId: "r500" });
      return json(200, { id: docId, version: "v1", schema: 1, text: "", blocks: content });
    }

    json(404, { message: "Not found", code: "NOT_FOUND", requestId: "r" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  assetBase = baseUrl;
  fixtures = buildFixtures(assetBase);

  return {
    baseUrl,
    assetBase,
    requests,
    failNext(prefix, status, code, times = 1, headers = {}) {
      failures.push({ prefix, status, code, times, headers });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
