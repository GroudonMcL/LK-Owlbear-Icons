import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { LkClient } from "../src/lk/client.js";
import { imageIdFor } from "../src/lk/extract.js";
import { PageService, ProjectRegistry } from "../src/services.js";
import { TokenStore } from "../src/tokenStore.js";
import { API_KEY, makePng, PROJECT_ID, startMockLk, type MockLk } from "./mockLk.js";

const ACCESS = "test-access-token-0123456789abcdef";
let lk: MockLk;
let server: http.Server;
let base = "";
let tokenDir = "";
let rateLimit = 1000;

async function start(options: { hosting?: boolean } = {}) {
  const config = loadConfig({
    LKTI_ACCESS_TOKENS: ACCESS,
    LK_API_KEYS: API_KEY,
    LK_BASE_URL: lk.baseUrl,
    LKTI_TOKEN_DIR: tokenDir,
    LKTI_TOKEN_HOSTING: options.hosting === false ? "off" : "on",
    LKTI_PUBLIC_URL: "https://tokens.example",
    LKTI_ALLOWED_ORIGINS: "https://ext.example",
    LKTI_INSECURE_ASSET_FETCH: "1",
    LKTI_RATE_LIMIT_PER_MINUTE: String(rateLimit),
  });
  const registry = new ProjectRegistry([new LkClient({ baseUrl: lk.baseUrl, apiKey: API_KEY, sleep: async () => {} })]);
  const pages = new PageService(registry, {
    maxSourceImageBytes: config.maxSourceImageBytes,
    assetHostAllowlist: null,
    allowInsecureAssetFetch: true,
  });
  let tokens: TokenStore | null = null;
  if (config.tokenStoreDir) {
    tokens = new TokenStore(config.tokenStoreDir, config.tokenStoreMaxBytes);
    await tokens.init();
  }
  server = http.createServer(createApp({ config, registry, pages, tokens, log: () => {} }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  await new Promise<void>((r) => server.close(() => r()));
}

function api(pathname: string, init: RequestInit = {}) {
  return fetch(base + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${ACCESS}`, Origin: "https://ext.example", ...(init.headers ?? {}) },
  });
}

beforeAll(async () => {
  lk = await startMockLk();
  tokenDir = await mkdtemp(path.join(os.tmpdir(), "lkti-tokens-"));
  await start();
});

afterAll(async () => {
  await stop();
  await lk.close();
  await rm(tokenDir, { recursive: true, force: true });
});

beforeEach(() => {
  lk.requests.length = 0;
});

describe("auth and CORS", () => {
  it("serves health without auth", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(await res.json()).toEqual({ ok: true, version: "0.1.0", tokenHosting: true });
  });

  it("rejects missing and wrong access tokens", async () => {
    const missing = await fetch(`${base}/api/projects`);
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("UNAUTHORIZED");
    const wrong = await fetch(`${base}/api/projects`, { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    expect(lk.requests).toEqual([]);
  });

  it("answers preflight for the allowed origin only", async () => {
    const ok = await fetch(`${base}/api/projects`, { method: "OPTIONS", headers: { Origin: "https://ext.example" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://ext.example");
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    const other = await fetch(`${base}/api/projects`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("projects and search", () => {
  it("lists the project behind each key", async () => {
    const body = await (await api("/api/projects")).json();
    expect(body).toEqual({ projects: [{ id: PROJECT_ID, name: "The Test Realm", isPublic: false }], failures: [] });
  });

  it("de-duplicates search hits and keeps the content match snippet", async () => {
    const body = await (await api(`/api/projects/${PROJECT_ID}/search?q=goblin`)).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ id: "goblin", name: "Goblin Boss", path: ["Bestiary"], tags: ["monster", "goblinoid"] });
  });

  it("caches identical searches", async () => {
    await api(`/api/projects/${PROJECT_ID}/search?q=dragon`);
    await api(`/api/projects/${PROJECT_ID}/search?q=Dragon`);
    expect(lk.requests.filter((r) => r.endsWith("/search"))).toHaveLength(1);
  });

  it("returns an empty list for blank searches without calling LegendKeeper", async () => {
    const body = await (await api(`/api/projects/${PROJECT_ID}/search?q=%20`)).json();
    expect(body.results).toEqual([]);
    expect(lk.requests).toEqual([]);
  });

  it("refuses projects it has no key for", async () => {
    const res = await api(`/api/projects/proj_other/search?q=x`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("PROJECT_NOT_CONFIGURED");
  });
});

describe("page details", () => {
  it("returns title, images, size and warnings but never asset URLs", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/goblin?fresh=1`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(lk.assetBase);
    expect(text).not.toContain("/assets/");
    const page = JSON.parse(text);
    expect(page).toMatchObject({ id: "goblin", name: "Goblin Boss", tags: ["monster", "goblinoid"] });
    expect(page.size).toMatchObject({ category: "small", source: "keyValue" });
    expect(page.images.map((i: { label: string }) => i.label)).toEqual([
      "Portrait", "Overview · image 1", "Goblin attacking", "Page image", "Banner",
    ]);
    // The "Broken" document fails upstream: reported, not fatal. The map document is not read.
    expect(page.warnings).toEqual(['The document "Broken" could not be read, so its images and stats are missing.']);
    expect(lk.requests).not.toContain(`GET /api/v3/projects/${PROJECT_ID}/resources/goblin/docs/doc2/blocks`);
  });

  it("maps a LegendKeeper 404 to PAGE_NOT_FOUND", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: "PAGE_NOT_FOUND", retryable: false });
  });

  it("maps upstream outages to a retryable error rather than an empty page", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/village`, 503, "INTERNAL", 3);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/village?fresh=1`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });

  it("explains key problems such as a lapsed plan", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/dragon`, 402, "PAID_PLAN_REQUIRED", 1);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon?fresh=1`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("UPSTREAM_AUTH");
    expect(body.error.message).toMatch(/paid plan/);
  });

  it("passes LegendKeeper rate limits through with Retry-After", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/dragon`, 429, "RATE_LIMITED", 1, { "retry-after": "90" });
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon?fresh=1`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfter: 90 });
  });

  it("rejects malformed ids", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/${encodeURIComponent("../etc")}`);
    expect(res.status).toBe(400);
  });
});

describe("image proxy", () => {
  it("serves an image that belongs to the page, sniffed from its bytes", async () => {
    const page = await (await api(`/api/projects/${PROJECT_ID}/pages/dragon`)).json();
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon/images/${page.images[0].id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png"); // served as .jpg upstream, sniffed as PNG
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
  });

  it("refuses image ids that are not on the page, even if they exist elsewhere", async () => {
    const goblinImage = imageIdFor(`${lk.assetBase}/assets/goblin-portrait.png`);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon/images/${goblinImage}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("IMAGE_NOT_FOUND");
  });

  it("reports images the asset host cannot serve", async () => {
    const page = await (await api(`/api/projects/${PROJECT_ID}/pages/missingimg`)).json();
    const res = await api(`/api/projects/${PROJECT_ID}/pages/missingimg/images/${page.images[0].id}`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "IMAGE_UNAVAILABLE", retryable: false });
  });
});

describe("token hosting", () => {
  it("stores a PNG once, serves it publicly with CORS, and deletes it", async () => {
    const png = makePng(256, 256);
    const first = await api("/api/tokens", { method: "POST", body: png, headers: { "Content-Type": "image/png" } });
    expect(first.status).toBe(201);
    const stored = await first.json();
    expect(stored).toMatchObject({ width: 256, height: 256, mime: "image/png", created: true });
    expect(stored.url).toBe(`https://tokens.example/t/${stored.hash}.png`);

    const again = await api("/api/tokens", { method: "POST", body: png });
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);

    const pub = await fetch(`${base}/t/${stored.hash}.png`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("access-control-allow-origin")).toBe("*");
    expect(pub.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await pub.arrayBuffer()).equals(png)).toBe(true);

    const del = await api(`/api/tokens/${stored.hash}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await fetch(`${base}/t/${stored.hash}.png`)).status).toBe(404);
    expect((await readdir(tokenDir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects non-images, oversized images and anonymous uploads", async () => {
    const notImage = await api("/api/tokens", { method: "POST", body: "<svg/>" });
    expect(notImage.status).toBe(415);
    const huge = await api("/api/tokens", { method: "POST", body: makePng(3000, 10) });
    expect(huge.status).toBe(400);
    const anon = await fetch(`${base}/api/tokens`, { method: "POST", body: makePng(64, 64) });
    expect(anon.status).toBe(401);
  });

  it("only serves well-formed token file names", async () => {
    expect((await fetch(`${base}/t/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${base}/t/abc.png`)).status).toBe(404);
  });

  it("reports when hosting is off", async () => {
    await stop();
    await start({ hosting: false });
    const res = await api("/api/tokens", { method: "POST", body: makePng(64, 64) });
    expect(res.status).toBe(404);
    expect((await (await fetch(`${base}/api/health`)).json()).tokenHosting).toBe(false);
    await stop();
    await start();
  });
});

describe("secrets", () => {
  it("never echoes the LegendKeeper key in any response", async () => {
    const responses = await Promise.all([
      api("/api/projects"),
      api(`/api/projects/${PROJECT_ID}/search?q=goblin`),
      api(`/api/projects/${PROJECT_ID}/pages/goblin`),
      api(`/api/projects/${PROJECT_ID}/pages/nope`),
    ]);
    for (const res of responses) expect(await res.text()).not.toContain(API_KEY);
  });
});

describe("rate limiting", () => {
  it("limits requests per access token", async () => {
    await stop();
    rateLimit = 3;
    await start();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await api("/api/projects")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    await stop();
    rateLimit = 1000;
    await start();
  });
});
