// Runs the deploy helpers against a mock of the Cloudflare REST API.

import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

let server: http.Server;
let api = "";
const state = { subdomain: "gm-realm" as string | null, namespaces: [] as { id: string; title: string }[], creates: 0, authOk: true };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!state.authOk) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/accounts/acct/workers/subdomain") {
      return state.subdomain
        ? send(200, { success: true, result: { subdomain: state.subdomain } })
        : send(404, { success: false, errors: [{ code: 10007, message: "This account does not have a subdomain" }] });
    }
    if (url.pathname === "/accounts/acct/storage/kv/namespaces" && req.method === "GET") {
      return send(200, { success: true, result: state.namespaces });
    }
    if (url.pathname === "/accounts/acct/storage/kv/namespaces" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        state.creates++;
        const ns = { id: `ns${state.creates}`.padEnd(32, "0"), title: JSON.parse(body).title };
        state.namespaces.push(ns);
        send(200, { success: true, result: ns });
      });
      return;
    }
    send(404, { success: false, errors: [{ code: 7003, message: "No route" }] });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lkti-deploy-"));
  copyFileSync(path.join(root, "wrangler.jsonc"), path.join(dir, "wrangler.jsonc"));
  return dir;
}

async function prepare(dir: string, env: Record<string, string> = {}) {
  const output = path.join(dir, "gh-output");
  writeFileSync(output, "");
  try {
    const r = await exec("node", [path.join(here, "prepare.mjs")], {
      cwd: dir,
      env: { ...process.env, CF_API_BASE: api, CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acct", GITHUB_OUTPUT: output, ...env },
    });
    return { code: 0, out: r.stdout + r.stderr, ghOutput: readFileSync(output, "utf8") };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr, ghOutput: "" };
  }
}

describe("deploy/prepare.mjs", () => {
  it("creates the token namespace once and reuses it on the next deploy", async () => {
    const first = workspace();
    const r1 = await prepare(first);
    expect(r1.code).toBe(0);
    expect(r1.ghOutput).toContain("subdomain=gm-realm");
    const id = state.namespaces[0].id;
    expect(readFileSync(path.join(first, "wrangler.jsonc"), "utf8")).toContain(`"id": "${id}"`);

    const second = workspace();
    const r2 = await prepare(second);
    expect(r2.code).toBe(0);
    expect(state.creates).toBe(1); // redeploys keep the same storage, so hosted tokens survive
    expect(readFileSync(path.join(second, "wrangler.jsonc"), "utf8")).toContain(`"id": "${id}"`);
  });

  it("explains a missing workers.dev subdomain", async () => {
    state.subdomain = null;
    const r = await prepare(workspace());
    state.subdomain = "gm-realm";
    expect(r.code).toBe(1);
    expect(r.out).toContain("Workers & Pages");
  });

  it("explains a bad API token", async () => {
    state.authOk = false;
    const r = await prepare(workspace());
    state.authOk = true;
    expect(r.code).toBe(1);
    expect(r.out).toContain("Edit Cloudflare Workers");
  });

  it("requires the Cloudflare secrets", async () => {
    const r = await prepare(workspace(), { CLOUDFLARE_API_TOKEN: "" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("deploy/secrets.mjs", () => {
  async function secrets(env: Record<string, string>) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lkti-secrets-"));
    const file = path.join(dir, "s.json");
    try {
      const r = await exec("node", [path.join(here, "secrets.mjs"), file], { env: { ...process.env, ...env } });
      return { code: 0, out: r.stdout + r.stderr, json: JSON.parse(readFileSync(file, "utf8")) };
    } catch (err) {
      const e = err as { code: number; stdout: string; stderr: string };
      return { code: e.code, out: e.stdout + e.stderr, json: null };
    }
  }

  it("writes the bulk-secrets file without printing values", async () => {
    const r = await secrets({ LK_API_KEYS: "lk_secret_value", LKTI_ACCESS_TOKENS: "a-long-access-token-0123456789" });
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ LK_API_KEYS: "lk_secret_value", LKTI_ACCESS_TOKENS: "a-long-access-token-0123456789" });
    expect(r.out).not.toContain("lk_secret_value");
  });

  it("rejects missing keys and short access tokens", async () => {
    expect((await secrets({ LK_API_KEYS: "", LKTI_ACCESS_TOKENS: "a-long-access-token-0123456789" })).code).toBe(1);
    const short = await secrets({ LK_API_KEYS: "k", LKTI_ACCESS_TOKENS: "short" });
    expect(short.code).toBe(1);
    expect(short.out).toContain("24 characters");
  });
});
