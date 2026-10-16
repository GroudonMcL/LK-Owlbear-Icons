import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/** Bridges Node's http server to a Web-standard (Request) => Response handler. */
export function toNodeListener(handle: (request: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "http";
    const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host || "localhost";
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      // Required by Node's fetch implementation for streamed request bodies.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);

    try {
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return void res.end();
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}
