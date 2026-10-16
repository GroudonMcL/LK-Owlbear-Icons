// Cloudflare Worker entry: one deployment serves the extension's static files
// (Workers Static Assets), the API under /api, and hosted tokens under /t.
// Nothing runs on the GM's computer; secrets live in the Worker's settings.

import { ConfigError, loadConfig, type Env as ConfigEnv } from "./core/config.js";
import { HttpError } from "./core/errors.js";
import { createHandler } from "./core/handler.js";
import { createFetchImageFetcher } from "./core/imageFetch.js";
import { LkClient } from "./core/lk/client.js";
import { PageService, ProjectRegistry } from "./core/services.js";
import {
  mimeForFile,
  sha256Hex,
  TOKEN_EXTENSIONS,
  TOKEN_FILE_PATTERN,
  type StoredToken,
  type TokenFile,
  type TokenMime,
  type TokenStore,
} from "./core/tokenStore.js";

/** The parts of Workers KV this store uses. */
export interface KvLike {
  getWithMetadata<M>(key: string, options: { type: "stream" }): Promise<{ value: ReadableStream<Uint8Array> | null; metadata: M | null }>;
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerEnv {
  ASSETS?: Fetcher;
  TOKENS?: KvLike;
  [key: string]: unknown;
}

interface TokenMeta {
  size: number;
  mime: TokenMime;
}

/** Token images in Workers KV, keyed by file name (hash + extension). */
export class KvTokenStore implements TokenStore {
  constructor(private readonly kv: KvLike) {}

  async put(data: Uint8Array, mime: TokenMime): Promise<StoredToken> {
    const hash = await sha256Hex(data);
    const fileName = `${hash}.${TOKEN_EXTENSIONS[mime]}`;
    const existing = await this.kv.getWithMetadata<TokenMeta>(fileName, { type: "stream" });
    if (existing.value) {
      await existing.value.cancel();
      return { hash, fileName, bytes: data.byteLength, created: false };
    }
    await this.kv.put(fileName, data, { metadata: { size: data.byteLength, mime } satisfies TokenMeta });
    return { hash, fileName, bytes: data.byteLength, created: true };
  }

  async get(fileName: string): Promise<TokenFile | null> {
    if (!TOKEN_FILE_PATTERN.test(fileName)) return null;
    const { value, metadata } = await this.kv.getWithMetadata<TokenMeta>(fileName, { type: "stream" });
    if (!value) return null;
    return { body: value, size: metadata?.size ?? 0, mime: metadata?.mime ?? mimeForFile(fileName) };
  }

  async remove(hash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    await Promise.all(Object.values(TOKEN_EXTENSIONS).map((ext) => this.kv.delete(`${hash}.${ext}`)));
    return true;
  }
}

function stringVars(env: WorkerEnv): ConfigEnv {
  const out: ConfigEnv = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === "string") out[key] = value;
  return out;
}

type Handler = (request: Request) => Promise<Response>;
let cached: { env: WorkerEnv; handle: Handler } | null = null;

/** Builds the API once per isolate; a configuration error is reported on every API call. */
function apiFor(env: WorkerEnv): Handler {
  if (cached?.env === env) return cached.handle;
  let handle: Handler;
  try {
    const config = loadConfig(stringVars(env));
    const clients = config.lkApiKeys.map((apiKey) => new LkClient({ baseUrl: config.lkBaseUrl, apiKey }));
    const registry = new ProjectRegistry(clients);
    const pages = new PageService(registry, {
      maxSourceImageBytes: config.maxSourceImageBytes,
      assetHostAllowlist: config.assetHostAllowlist,
      allowInsecureAssetFetch: config.allowInsecureAssetFetch,
      fetchImage: createFetchImageFetcher(),
    });
    const tokens = config.tokenHosting && env.TOKENS ? new KvTokenStore(env.TOKENS) : null;
    handle = createHandler({ config, registry, pages, tokens });
  } catch (err) {
    const message =
      err instanceof ConfigError
        ? `The importer is deployed but not configured: ${err.message}. Add the secret in the Worker's settings (or the GitHub repository secrets) and redeploy.`
        : "The importer failed to start.";
    const body = new HttpError(503, "INTERNAL", message).toBody();
    handle = async () => new Response(JSON.stringify(body), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  cached = { env, handle };
  return handle;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/t/") && request.method === "GET") {
      // Finished tokens are immutable: serve repeat loads from the edge cache
      // rather than KV (only successful responses are cached).
      const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
      const hit = await cache?.match(request);
      if (hit) return hit;
      const response = await apiFor(env)(request);
      if (cache && response.status === 200) ctx.waitUntil(cache.put(request, response.clone()));
      return response;
    }

    const deleted = /^\/api\/tokens\/([a-f0-9]{64})$/.exec(pathname);
    if (deleted && request.method === "DELETE") {
      const response = await apiFor(env)(request);
      // A cancelled placement may already have pulled the image into the edge cache.
      const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
      if (cache && response.status === 204) {
        const origin = new URL(request.url).origin;
        ctx.waitUntil(Promise.all(Object.values(TOKEN_EXTENSIONS).map((ext) => cache.delete(`${origin}/t/${deleted[1]}.${ext}`))));
      }
      return response;
    }

    if (pathname.startsWith("/api/") || pathname.startsWith("/t/")) return apiFor(env)(request);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
