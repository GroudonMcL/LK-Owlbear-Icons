// Runs in GitHub Actions before `wrangler deploy`. It checks the Cloudflare
// account is ready, finds or creates the KV namespace that stores hosted
// tokens (by name, so redeploys keep every token), and writes its id into
// wrangler.jsonc in the CI workspace. Nothing here is committed.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_TITLE (optional)

import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "00000000000000000000000000000000";
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const title = process.env.KV_TITLE || "lk-token-importer-tokens";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!token || !account) {
  fail("Add the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repository secrets (see README, 'Deploy').");
}

async function cf(path, init = {}) {
  const api = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4";
  const res = await fetch(`${api}/accounts/${account}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const reason = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    return { ok: false, status: res.status, reason, body };
  }
  return { ok: true, body };
}

// A new account has no workers.dev subdomain until one is chosen.
const sub = await cf("/workers/subdomain");
if (!sub.ok) {
  if (sub.status === 403 || sub.status === 401) {
    fail(`Cloudflare refused the API token (${sub.reason}). Create it from the "Edit Cloudflare Workers" template.`);
  }
  fail(
    `Could not read the account's workers.dev subdomain (Cloudflare said: ${sub.reason}). A new account has none ` +
      "until you open dash.cloudflare.com → Workers & Pages once and pick one; do that, then re-run this workflow.",
  );
}
console.log(`workers.dev subdomain: ${sub.body.result.subdomain}`);

// Find the namespace by title across pages, or create it.
let id = null;
for (let page = 1; page <= 20 && !id; page++) {
  const list = await cf(`/storage/kv/namespaces?per_page=100&page=${page}`);
  if (!list.ok) fail(`Could not list KV namespaces: ${list.reason}`);
  id = list.body.result.find((ns) => ns.title === title)?.id ?? null;
  if (list.body.result.length < 100) break;
}
if (id) {
  console.log(`Using KV namespace "${title}" (${id})`);
} else {
  const created = await cf("/storage/kv/namespaces", { method: "POST", body: JSON.stringify({ title }) });
  if (!created.ok) fail(`Could not create KV namespace "${title}": ${created.reason}`);
  id = created.body.result.id;
  console.log(`Created KV namespace "${title}" (${id})`);
}

const config = readFileSync("wrangler.jsonc", "utf8");
if (!config.includes(PLACEHOLDER)) fail("wrangler.jsonc no longer contains the KV id placeholder.");
writeFileSync("wrangler.jsonc", config.replace(PLACEHOLDER, id));
writeFileSync(process.env.GITHUB_OUTPUT ?? "/dev/null", `subdomain=${sub.body.result.subdomain}\n`, { flag: "a" });
