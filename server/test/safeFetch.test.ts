import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFetchImageFetcher, hostAllowed, isBlockedAddress, type ImageFetcher } from "../src/core/imageFetch.js";
import { ipFamily, parseV6 } from "../src/core/ipRanges.js";
import { guardedLookup, safeFetch } from "../src/node/safeFetch.js";

const FETCHERS: [string, ImageFetcher][] = [
  ["node (DNS-pinned)", safeFetch],
  ["edge (fetch-based)", createFetchImageFetcher()],
];

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "not-an-ip", "1.2.3",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "172.32.0.1"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("parses IPv6 forms", () => {
    expect(parseV6("::1")).toBe(1n);
    expect(parseV6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(ipFamily("example.com")).toBe(0);
    expect(ipFamily("::1")).toBe(6);
  });
});

describe("hostAllowed", () => {
  it("matches exact hosts and subdomains only", () => {
    const allow = ["legendkeeper.com"];
    expect(hostAllowed("legendkeeper.com", allow)).toBe(true);
    expect(hostAllowed("assets.legendkeeper.com", allow)).toBe(true);
    expect(hostAllowed("evil-legendkeeper.com", allow)).toBe(false);
    expect(hostAllowed("legendkeeper.com.evil.io", allow)).toBe(false);
    expect(hostAllowed("anything.example", null)).toBe(true);
  });
});

describe("guardedLookup (node)", () => {
  it("rejects names that resolve to private addresses at connect time", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      guardedLookup("localhost", {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe("EBLOCKED");
  });

  it("passes public answers through in both callback shapes", async () => {
    const original = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }]);
    try {
      const single = await new Promise<unknown[]>((resolve) => guardedLookup("example.com", {}, (...args) => resolve(args)));
      expect(single).toEqual([null, "93.184.216.34", 4]);
      const all = await new Promise<unknown[]>((resolve) => guardedLookup("example.com", { all: true }, (...args) => resolve(args)));
      expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    } finally {
      (dns as { lookup: unknown }).lookup = original;
    }
  });
});

describe.each(FETCHERS)("%s: URL policy (secure mode)", (_name, fetcher) => {
  const opts = { maxBytes: 1024, allowHosts: null, timeoutMs: 3000 };

  it("refuses plain http", async () => {
    await expect(fetcher("http://example.com/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("refuses private IP literals and local names", async () => {
    await expect(fetcher("https://127.0.0.1/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher("https://[::1]/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher("https://169.254.169.254/latest/meta-data", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher("https://localhost:9/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher("https://metadata.google.internal/", opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("refuses hosts outside the allowlist and URLs with credentials", async () => {
    await expect(fetcher("https://example.com/a.png", { ...opts, allowHosts: ["legendkeeper.com"] })).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher("https://user:pw@example.com/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
  });
});

describe.each(FETCHERS)("%s: transport (insecure test mode)", (_name, fetcher) => {
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200);
        res.end(Buffer.alloc(5000));
      } else if (req.url === "/big-chunked") {
        res.writeHead(200, { "Transfer-Encoding": "chunked" });
        for (let i = 0; i < 10; i++) res.write(Buffer.alloc(500));
        res.end();
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/small" });
        res.end();
      } else if (req.url === "/redirect-out") {
        res.writeHead(302, { Location: "https://169.254.169.254/" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" });
        res.end();
      } else if (req.url === "/small") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("tiny"));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const opts = { maxBytes: 1024, allowHosts: null, allowInsecure: true };

  it("enforces the byte limit from Content-Length and while streaming", async () => {
    await expect(fetcher(`${base}/big`, opts)).rejects.toMatchObject({ reason: "too_large" });
    await expect(fetcher(`${base}/big-chunked`, opts)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("follows redirects and returns the body", async () => {
    const result = await fetcher(`${base}/redirect`, opts);
    expect(new TextDecoder().decode(result.body)).toBe("tiny");
    expect(result.contentType).toBe("image/png");
  });

  it("re-validates redirect targets and stops redirect loops", async () => {
    await expect(fetcher(`${base}/redirect-out`, { ...opts, allowHosts: ["127.0.0.1"] })).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetcher(`${base}/loop`, opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("reports upstream status codes", async () => {
    await expect(fetcher(`${base}/missing`, opts)).rejects.toMatchObject({ reason: "http_status", status: 404 });
  });
});
