// Local demo: a mock LegendKeeper plus the real backend, so the extension UI
// can be tried without a paid LegendKeeper key or an Owlbear room.
//   npm run demo            (backend on :8787, token "demo-access-token-…")
//   npm run dev:extension   then open http://localhost:5173/?mock

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { LkClient } from "../src/lk/client.js";
import { PageService, ProjectRegistry } from "../src/services.js";
import { TokenStore } from "../src/tokenStore.js";
import { API_KEY, startMockLk } from "./mockLk.js";

const ACCESS_TOKEN = "demo-access-token-not-for-production";
const port = Number(process.env.PORT ?? 8787);

const lk = await startMockLk();
const config = loadConfig({
  LKTI_ACCESS_TOKENS: ACCESS_TOKEN,
  LK_API_KEYS: API_KEY,
  LK_BASE_URL: lk.baseUrl,
  LKTI_TOKEN_DIR: path.join(os.tmpdir(), "lkti-demo-tokens"),
  LKTI_PUBLIC_URL: `http://localhost:${port}`,
  LKTI_INSECURE_ASSET_FETCH: "1",
});
const registry = new ProjectRegistry([new LkClient({ baseUrl: lk.baseUrl, apiKey: API_KEY })]);
const pages = new PageService(registry, {
  maxSourceImageBytes: config.maxSourceImageBytes,
  assetHostAllowlist: null,
  allowInsecureAssetFetch: true,
});
const tokens = new TokenStore(config.tokenStoreDir!, config.tokenStoreMaxBytes);
await tokens.init();
http.createServer(createApp({ config, registry, pages, tokens })).listen(port, () => {
  console.log(`Demo backend on http://localhost:${port} (mock LegendKeeper at ${lk.baseUrl})`);
  console.log(`Access token: ${ACCESS_TOKEN}`);
});
