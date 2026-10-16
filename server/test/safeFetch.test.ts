import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostAllowed, isBlockedAddress, safeFetch } from "../src/safeFetch.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
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

describe("safeFetch (secure mode)", () => {
  const opts = { maxBytes: 1024, allowHosts: null, timeoutMs: 3000 };

  it("refuses plain http", async () => {
    await expect(safeFetch("http://example.com/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("refuses private IP literals", async () => {
    await expect(safeFetch("https://127.0.0.1/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(safeFetch("https://[::1]/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
    await expect(safeFetch("https://169.254.169.254/latest/meta-data", opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("refuses hostnames that resolve to private addresses, at connect time", async () => {
    await expect(safeFetch("https://localhost:9/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("refuses hosts outside the allowlist and URLs with credentials", async () => {
    await expect(safeFetch("https://example.com/a.png", { ...opts, allowHosts: ["legendkeeper.com"] })).rejects.toMatchObject({ reason: "blocked" });
    await expect(safeFetch("https://user:pw@example.com/a.png", opts)).rejects.toMatchObject({ reason: "blocked" });
  });
});

describe("safeFetch (transport, insecure test mode)", () => {
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200);
        res.end(Buffer.alloc(5000));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/small" });
        res.end();
      } else if (req.url === "/redirect-out") {
        res.writeHead(302, { Location: "https://169.254.169.254/" });
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

  it("enforces the byte limit while streaming", async () => {
    await expect(safeFetch(`${base}/big`, opts)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("follows redirects and returns the body", async () => {
    const result = await safeFetch(`${base}/redirect`, opts);
    expect(result.body.toString()).toBe("tiny");
    expect(result.contentType).toBe("image/png");
  });

  it("re-validates redirect targets against the allowlist", async () => {
    await expect(safeFetch(`${base}/redirect-out`, { ...opts, allowHosts: ["127.0.0.1"] })).rejects.toMatchObject({ reason: "blocked" });
  });

  it("reports upstream status codes", async () => {
    await expect(safeFetch(`${base}/missing`, opts)).rejects.toMatchObject({ reason: "http_status", status: 404 });
  });
});
