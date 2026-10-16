// Fetching page images for the proxy without becoming an open proxy. Callers
// only pass URLs extracted from a LegendKeeper page; on top of that, every URL
// (including each redirect hop) must be https, credential-free, inside the
// optional host allowlist, and not a private IP literal. Bodies are capped
// while streaming.

import { ipFamily, isBlockedAddress } from "./ipRanges.js";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly reason: "blocked" | "too_large" | "http_status" | "network" | "timeout",
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Hostnames (or parent domains) that may be contacted; null allows any public host. */
  allowHosts: string[] | null;
  /** Test-only: allow http:// and private addresses. */
  allowInsecure?: boolean;
}

export interface SafeFetchResult {
  body: Uint8Array;
  contentType: string | null;
}

export type ImageFetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;

export { isBlockedAddress };

export function hostAllowed(hostname: string, allowHosts: string[] | null): boolean {
  if (!allowHosts) return true;
  const host = hostname.toLowerCase();
  return allowHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function validateImageUrl(raw: string, options: SafeFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("Invalid image URL", "blocked");
  }
  const allowedProtocols = options.allowInsecure ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) throw new SafeFetchError("Only https image URLs are fetched", "blocked");
  if (url.username || url.password) throw new SafeFetchError("Credentials in image URLs are not allowed", "blocked");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostAllowed(hostname, options.allowHosts)) throw new SafeFetchError(`Host ${hostname} is not allowed`, "blocked");
  if (!options.allowInsecure) {
    if (ipFamily(hostname) !== 0 && isBlockedAddress(hostname)) {
      throw new SafeFetchError("Refusing to fetch from a non-public address", "blocked");
    }
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
      throw new SafeFetchError("Refusing to fetch from a non-public address", "blocked");
    }
  }
  return url;
}

/** Reads a response body, failing as soon as it exceeds `maxBytes`. */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new SafeFetchError("Image is larger than the allowed size", "too_large");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError("Image is larger than the allowed size", "too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * fetch-based fetcher for edge runtimes (Cloudflare Workers), which have no
 * private network to reach and no DNS hooks; URL checks run on every hop.
 */
export function createFetchImageFetcher(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): ImageFetcher {
  return async (rawUrl, options) => {
    let url = validateImageUrl(rawUrl, options);
    const maxRedirects = options.maxRedirects ?? 3;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          redirect: "manual",
          headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1" },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        });
      } catch (err) {
        const timedOut = (err as Error)?.name === "TimeoutError";
        throw new SafeFetchError(timedOut ? "Image request timed out" : `Image host unreachable: ${(err as Error).message}`, timedOut ? "timeout" : "network");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new SafeFetchError(`Image host answered ${response.status}`, "http_status", response.status);
        url = validateImageUrl(new URL(location, url).toString(), options);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SafeFetchError(`Image host answered ${response.status}`, "http_status", response.status);
      }
      return { body: await readCapped(response, options.maxBytes), contentType: response.headers.get("content-type") };
    }
    throw new SafeFetchError("Too many redirects", "blocked");
  };
}
