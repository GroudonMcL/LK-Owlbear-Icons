// The HTTP API as a Web-standard (Request) => Response function, so the same
// code runs in Cloudflare Workers and, through a thin adapter, in Node.

import type { HealthResponse, TokenUploadResponse } from "@lkti/shared";
import type { Config } from "./config.js";
import { badRequest, HttpError } from "./errors.js";
import { readDimensions, sniffImageMime } from "./imageSniff.js";
import type { PageService, ProjectRegistry } from "./services.js";
import { sha256Hex, StoreFullError, type TokenStore } from "./tokenStore.js";

export const VERSION = "0.2.0";

export interface HandlerDeps {
  config: Config;
  registry: ProjectRegistry;
  pages: PageService;
  tokens: TokenStore | null;
  log?: (message: string) => void;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_ID_PATTERN = /^[a-f0-9]{16,64}$/;
const MAX_QUERY_LENGTH = 200;
const MAX_TOKEN_DIMENSION = 2048;
const MIN_TOKEN_DIMENSION = 32;

class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly perMinute: number) {}

  check(key: string): number | null {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 1000) this.windows.clear();
      return null;
    }
    window.count += 1;
    if (window.count > this.perMinute) return Math.ceil((window.start + 60_000 - now) / 1000);
    return null;
  }
}

/** Equal-length hex digests compared without an early exit. */
function digestsEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Token image is too large.");
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Token image is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const { config, registry, pages, tokens } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const tokenDigests = Promise.all(config.accessTokens.map((t) => sha256Hex(t)));
  const limiter = new RateLimiter(config.rateLimitPerMinute);

  function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin") ?? "";
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Expose-Headers": "Retry-After",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
    if (config.allowedOrigins === "*") headers["Access-Control-Allow-Origin"] = "*";
    else if (origin && config.allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
  }

  /** Returns a rate-limit key for a valid token; throws otherwise. */
  async function authenticate(request: Request): Promise<string> {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!match) throw new HttpError(401, "UNAUTHORIZED", "Missing access token. Add it in the extension settings.");
    const candidate = await sha256Hex(match[1].trim());
    const index = (await tokenDigests).findIndex((d) => digestsEqual(d, candidate));
    if (index < 0) throw new HttpError(401, "UNAUTHORIZED", "The access token was not accepted by the server.");
    return `t${index}`;
  }

  function tokenUrl(request: Request, fileName: string): string {
    const base = config.publicBaseUrl ?? new URL(request.url).origin;
    return `${base}/t/${fileName}`;
  }

  async function serveToken(request: Request, fileName: string): Promise<Response> {
    const common = {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    };
    const file = tokens ? await tokens.get(fileName) : null;
    if (!file) return json(404, new HttpError(404, "NOT_FOUND", "Not found").toBody(), common);
    return new Response(request.method === "HEAD" ? null : file.body, {
      status: 200,
      headers: {
        ...common,
        "Content-Type": file.mime,
        "Content-Length": String(file.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  }

  async function route(request: Request, cors: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    let parts: string[];
    try {
      parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      throw badRequest("Malformed path.");
    }
    const method = request.method;

    // Public, unauthenticated routes.
    if (parts[0] === "t" && parts.length === 2 && (method === "GET" || method === "HEAD")) {
      return serveToken(request, parts[1]);
    }
    if (parts[0] !== "api") throw new HttpError(404, "NOT_FOUND", "Not found");
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (parts[1] === "health" && parts.length === 2 && method === "GET") {
      const body: HealthResponse = { ok: true, version: VERSION, tokenHosting: tokens !== null };
      return json(200, body, cors);
    }

    const rateKey = await authenticate(request);
    const wait = limiter.check(rateKey);
    if (wait !== null) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests. Slow down a little.", { retryable: true, retryAfter: wait });
    }

    // GET /api/projects
    if (parts[1] === "projects" && parts.length === 2 && method === "GET") {
      return json(200, await registry.list(url.searchParams.get("refresh") === "1"), cors);
    }

    if (parts[1] === "projects" && parts.length >= 4) {
      const projectId = parts[2];
      if (!ID_PATTERN.test(projectId)) throw badRequest("Invalid project id.");

      // GET /api/projects/:projectId/search?q=&limit=
      if (parts[3] === "search" && parts.length === 4 && method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (q.length > MAX_QUERY_LENGTH) throw badRequest("Search text is too long.");
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
        if (!q) return json(200, { query: "", results: [], limited: false }, cors);
        return json(200, await pages.search(projectId, q, limit), cors);
      }

      if (parts[3] === "pages" && parts.length >= 5) {
        const resourceId = parts[4];
        if (!ID_PATTERN.test(resourceId)) throw badRequest("Invalid page id.");

        // GET /api/projects/:projectId/pages/:resourceId
        if (parts.length === 5 && method === "GET") {
          const page = await pages.getPage(projectId, resourceId, url.searchParams.get("fresh") === "1");
          return json(200, page.details, cors);
        }

        // GET /api/projects/:projectId/pages/:resourceId/images/:imageId
        if (parts[5] === "images" && parts.length === 7 && method === "GET") {
          const imageId = parts[6];
          if (!IMAGE_ID_PATTERN.test(imageId)) throw badRequest("Invalid image id.");
          const image = await pages.getImage(projectId, resourceId, imageId);
          return new Response(image.body, {
            status: 200,
            headers: {
              ...cors,
              "Content-Type": image.mime,
              "Content-Length": String(image.body.byteLength),
              "Cache-Control": "private, max-age=600",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        }
      }
    }

    if (parts[1] === "tokens") {
      if (!tokens) throw new HttpError(404, "NOT_FOUND", "Token hosting is turned off on this server.");

      // POST /api/tokens  (body: PNG or WebP bytes)
      if (parts.length === 2 && method === "POST") {
        const body = await readBody(request, config.maxTokenUploadBytes);
        const mime = sniffImageMime(body);
        if (mime !== "image/png" && mime !== "image/webp") {
          throw new HttpError(415, "UNSUPPORTED_IMAGE", "Token images must be PNG or WebP.");
        }
        const dims = readDimensions(body, mime);
        if (
          !dims ||
          dims.width < MIN_TOKEN_DIMENSION || dims.height < MIN_TOKEN_DIMENSION ||
          dims.width > MAX_TOKEN_DIMENSION || dims.height > MAX_TOKEN_DIMENSION
        ) {
          throw new HttpError(400, "BAD_REQUEST", `Token images must be ${MIN_TOKEN_DIMENSION}–${MAX_TOKEN_DIMENSION} px per side.`);
        }
        let stored;
        try {
          stored = await tokens.put(body, mime);
        } catch (err) {
          if (err instanceof StoreFullError) throw new HttpError(507, "STORAGE_FULL", "The server's token storage is full.");
          throw err;
        }
        const response: TokenUploadResponse = {
          url: tokenUrl(request, stored.fileName),
          hash: stored.hash,
          width: dims.width,
          height: dims.height,
          mime,
          bytes: stored.bytes,
          created: stored.created,
        };
        return json(stored.created ? 201 : 200, response, cors);
      }

      // DELETE /api/tokens/:hash  (cleanup after a failed placement)
      if (parts.length === 3 && method === "DELETE") {
        if (!/^[a-f0-9]{64}$/.test(parts[2])) throw badRequest("Invalid token id.");
        await tokens.remove(parts[2]);
        return new Response(null, { status: 204, headers: cors });
      }
    }

    throw new HttpError(404, "NOT_FOUND", "Not found");
  }

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request);
    const started = Date.now();
    let response: Response;
    try {
      response = await route(request, cors);
    } catch (err) {
      const error = err instanceof HttpError ? err : new HttpError(500, "INTERNAL", "Unexpected server error.");
      if (!(err instanceof HttpError)) log(`[error] ${request.method} ${new URL(request.url).pathname}: ${(err as Error)?.stack ?? err}`);
      const headers: Record<string, string> = { ...cors };
      if (error.options.retryAfter !== undefined) headers["Retry-After"] = String(error.options.retryAfter);
      response = json(error.status, error.toBody(), headers);
    }
    // Paths only: queries may contain campaign search text.
    log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${Date.now() - started}ms`);
    return response;
  };
}
