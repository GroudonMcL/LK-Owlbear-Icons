import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HealthResponse, TokenUploadResponse } from "@lkti/shared";
import type { Config } from "./config.js";
import { badRequest, HttpError } from "./errors.js";
import { readDimensions, sniffImageMime } from "./imageSniff.js";
import type { PageService, ProjectRegistry } from "./services.js";
import { StoreFullError, type TokenStore } from "./tokenStore.js";

export const VERSION = "0.1.0";

export interface AppDeps {
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

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

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

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Token image is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Token image is too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createApp(deps: AppDeps) {
  const { config, registry, pages, tokens } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const tokenDigests = config.accessTokens.map(digest);
  const limiter = new RateLimiter(config.rateLimitPerMinute);

  function corsHeaders(req: IncomingMessage): Record<string, string> {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
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
  function authenticate(req: IncomingMessage): string {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new HttpError(401, "UNAUTHORIZED", "Missing access token. Add it in the extension settings.");
    const candidate = digest(match[1].trim());
    const index = tokenDigests.findIndex((d) => timingSafeEqual(d, candidate));
    if (index < 0) throw new HttpError(401, "UNAUTHORIZED", "The access token was not accepted by the server.");
    return `t${index}`;
  }

  function tokenUrl(req: IncomingMessage, fileName: string): string {
    if (config.publicBaseUrl) return `${config.publicBaseUrl}/t/${fileName}`;
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "http";
    const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host || "localhost";
    return `${proto}://${host}/t/${fileName}`;
  }

  async function serveToken(req: IncomingMessage, res: ServerResponse, fileName: string): Promise<void> {
    const file = tokens?.resolve(fileName);
    const common = {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    };
    if (!file) return sendJson(res, 404, new HttpError(404, "NOT_FOUND", "Not found").toBody(), common);
    let size: number;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      return sendJson(res, 404, new HttpError(404, "NOT_FOUND", "Not found").toBody(), common);
    }
    res.writeHead(200, {
      ...common,
      "Content-Type": fileName.endsWith(".webp") ? "image/webp" : "image/png",
      "Content-Length": size,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }

  async function route(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<void> {
    const url = new URL(req.url ?? "/", "http://internal");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method ?? "GET";

    // Public, unauthenticated routes.
    if (parts[0] === "t" && parts.length === 2 && (method === "GET" || method === "HEAD")) {
      return serveToken(req, res, parts[1]);
    }
    if (parts[0] !== "api") throw new HttpError(404, "NOT_FOUND", "Not found");
    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      return void res.end();
    }
    if (parts[1] === "health" && parts.length === 2 && method === "GET") {
      const body: HealthResponse = { ok: true, version: VERSION, tokenHosting: tokens !== null };
      return sendJson(res, 200, body, cors);
    }

    const rateKey = authenticate(req);
    const wait = limiter.check(rateKey);
    if (wait !== null) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests. Slow down a little.", { retryable: true, retryAfter: wait });
    }

    // GET /api/projects
    if (parts[1] === "projects" && parts.length === 2 && method === "GET") {
      return sendJson(res, 200, await registry.list(url.searchParams.get("refresh") === "1"), cors);
    }

    if (parts[1] === "projects" && parts.length >= 4) {
      const projectId = parts[2];
      if (!ID_PATTERN.test(projectId)) throw badRequest("Invalid project id.");

      // GET /api/projects/:projectId/search?q=&limit=
      if (parts[3] === "search" && parts.length === 4 && method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (q.length > MAX_QUERY_LENGTH) throw badRequest("Search text is too long.");
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
        if (!q) return sendJson(res, 200, { query: "", results: [], limited: false }, cors);
        return sendJson(res, 200, await pages.search(projectId, q, limit), cors);
      }

      if (parts[3] === "pages" && parts.length >= 5) {
        const resourceId = parts[4];
        if (!ID_PATTERN.test(resourceId)) throw badRequest("Invalid page id.");

        // GET /api/projects/:projectId/pages/:resourceId
        if (parts.length === 5 && method === "GET") {
          const page = await pages.getPage(projectId, resourceId, url.searchParams.get("fresh") === "1");
          return sendJson(res, 200, page.details, cors);
        }

        // GET /api/projects/:projectId/pages/:resourceId/images/:imageId
        if (parts[5] === "images" && parts.length === 7 && method === "GET") {
          const imageId = parts[6];
          if (!IMAGE_ID_PATTERN.test(imageId)) throw badRequest("Invalid image id.");
          const image = await pages.getImage(projectId, resourceId, imageId);
          res.writeHead(200, {
            ...cors,
            "Content-Type": image.mime,
            "Content-Length": image.body.length,
            "Cache-Control": "private, max-age=600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
          });
          return void res.end(image.body);
        }
      }
    }

    if (parts[1] === "tokens") {
      if (!tokens) throw new HttpError(404, "NOT_FOUND", "Token hosting is turned off on this server.");

      // POST /api/tokens  (body: PNG or WebP bytes)
      if (parts.length === 2 && method === "POST") {
        const body = await readBody(req, config.maxTokenUploadBytes);
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
          url: tokenUrl(req, stored.fileName),
          hash: stored.hash,
          width: dims.width,
          height: dims.height,
          mime,
          bytes: stored.bytes,
          created: stored.created,
        };
        return sendJson(res, stored.created ? 201 : 200, response, cors);
      }

      // DELETE /api/tokens/:hash  (cleanup after a failed placement)
      if (parts.length === 3 && method === "DELETE") {
        if (!/^[a-f0-9]{64}$/.test(parts[2])) throw badRequest("Invalid token id.");
        await tokens.remove(parts[2]);
        res.writeHead(204, cors);
        return void res.end();
      }
    }

    throw new HttpError(404, "NOT_FOUND", "Not found");
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = corsHeaders(req);
    const started = Date.now();
    try {
      await route(req, res, cors);
    } catch (err) {
      const error =
        err instanceof HttpError ? err : new HttpError(500, "INTERNAL", "Unexpected server error.");
      if (!(err instanceof HttpError)) log(`[error] ${req.method} ${req.url?.split("?")[0]}: ${(err as Error)?.stack ?? err}`);
      if (res.headersSent) return void res.destroy();
      const headers: Record<string, string> = { ...cors };
      if (error.options.retryAfter !== undefined) headers["Retry-After"] = String(error.options.retryAfter);
      sendJson(res, error.status, error.toBody(), headers);
    } finally {
      // Paths only: queries may contain campaign search text.
      log(`${req.method} ${req.url?.split("?")[0]} ${res.statusCode} ${Date.now() - started}ms`);
    }
  };
}
