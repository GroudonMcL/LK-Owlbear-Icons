// Fetches page images for the proxy without becoming an open proxy or an SSRF
// vector. The caller only passes URLs extracted from a LegendKeeper page; this
// module additionally enforces https, an optional host allowlist, a size cap,
// and rejects any connection to private/loopback/link-local addresses. The
// address check runs inside the socket's DNS lookup, so a hostname cannot
// resolve to a public address for the check and a private one for the connect.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

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
  body: Buffer;
  contentType: string | null;
}

const blockList = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockList.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
  ["64:ff9b::", 96], ["100::", 64], ["2002::", 16],
] as const) {
  blockList.addSubnet(address, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blockList.check(mapped[1], "ipv4");
    return blockList.check(address, "ipv6");
  }
  return true;
}

export function hostAllowed(hostname: string, allowHosts: string[] | null): boolean {
  if (!allowHosts) return true;
  const host = hostname.toLowerCase();
  return allowHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => isBlockedAddress(a.address));
    if (blocked || list.length === 0) {
      const e = new Error(`Refusing to connect to non-public address for ${hostname}`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function validateUrl(raw: string, options: SafeFetchOptions): URL {
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
  // IP literals skip DNS lookup, so check them here.
  if (!options.allowInsecure && net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new SafeFetchError("Refusing to fetch from a non-public address", "blocked");
  }
  return url;
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<{ status: number; location?: string; result?: SafeFetchResult }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1", "User-Agent": "lk-token-importer/0.1" },
        lookup: options.allowInsecure ? undefined : (guardedLookup as unknown as typeof dns.lookup),
        timeout: options.timeoutMs ?? 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location });
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
          resolve({ status, result: { body: Buffer.concat(chunks), contentType } });
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

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  let url = validateUrl(rawUrl, options);
  const maxRedirects = options.maxRedirects ?? 3;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await requestOnce(url, options);
    if (response.result) return response.result;
    url = validateUrl(new URL(response.location!, url).toString(), options);
  }
  throw new SafeFetchError("Too many redirects", "blocked");
}
