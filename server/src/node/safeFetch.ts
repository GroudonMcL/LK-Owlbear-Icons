// Node fetcher for self-hosting. On a server inside a private network, URL
// checks alone are not enough: a hostname could resolve to an internal
// address. Here the address check runs inside the socket's DNS lookup, so a
// name cannot resolve to a public address for the check and a private one
// for the connect.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import {
  isBlockedAddress,
  SafeFetchError,
  validateImageUrl,
  type ImageFetcher,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "../core/imageFetch.js";

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const e = new Error(`Refusing to connect to non-public address for ${hostname}`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<{ location?: string; result?: SafeFetchResult }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1", "User-Agent": "lk-token-importer/0.2" },
        lookup: options.allowInsecure ? undefined : (guardedLookup as unknown as typeof dns.lookup),
        timeout: options.timeoutMs ?? 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ location: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new SafeFetchError(`Image host answered ${status}`, "http_status", status));
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          return reject(new SafeFetchError("Image is larger than the allowed size", "too_large"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            res.destroy();
            reject(new SafeFetchError("Image is larger than the allowed size", "too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const contentType = typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : null;
          resolve({ result: { body: new Uint8Array(Buffer.concat(chunks)), contentType } });
        });
        res.on("error", (err) => reject(new SafeFetchError(err.message, "network")));
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("Image request timed out", "timeout")));
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof SafeFetchError) return reject(err);
      if (err.code === "EBLOCKED") return reject(new SafeFetchError(err.message, "blocked"));
      reject(new SafeFetchError(err.message, "network"));
    });
    req.end();
  });
}

export const safeFetch: ImageFetcher = async (rawUrl, options) => {
  let url = validateImageUrl(rawUrl, options);
  const maxRedirects = options.maxRedirects ?? 3;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await requestOnce(url, options);
    if (response.result) return response.result;
    url = validateImageUrl(new URL(response.location!, url).toString(), options);
  }
  throw new SafeFetchError("Too many redirects", "blocked");
};
