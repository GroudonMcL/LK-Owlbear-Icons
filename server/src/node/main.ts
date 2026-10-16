// Optional self-hosted entry (VPS, container). The recommended deployment is
// the Cloudflare Worker in ../worker.ts, which needs nothing installed.

import http from "node:http";
import path from "node:path";
import { ConfigError, loadConfig } from "../core/config.js";
import { createHandler, VERSION } from "../core/handler.js";
import { LkClient } from "../core/lk/client.js";
import { PageService, ProjectRegistry } from "../core/services.js";
import { toNodeListener } from "./adapter.js";
import { FileTokenStore } from "./fileTokenStore.js";
import { safeFetch } from "./safeFetch.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const clients = config.lkApiKeys.map((apiKey) => new LkClient({ baseUrl: config.lkBaseUrl, apiKey }));
  const registry = new ProjectRegistry(clients);
  const pages = new PageService(registry, {
    maxSourceImageBytes: config.maxSourceImageBytes,
    assetHostAllowlist: config.assetHostAllowlist,
    allowInsecureAssetFetch: config.allowInsecureAssetFetch,
    fetchImage: safeFetch,
  });

  let tokens: FileTokenStore | null = null;
  if (config.tokenHosting) {
    tokens = new FileTokenStore(path.resolve(config.tokenStoreDir), config.tokenStoreMaxBytes);
    await tokens.init();
  }

  if (config.allowedOrigins === "*") {
    console.warn("LKTI_ALLOWED_ORIGINS is not set: any origin may call the API (the access token is still required).");
  }
  if (tokens && !config.publicBaseUrl) {
    console.warn("LKTI_PUBLIC_URL is not set: token URLs will be derived from the request's Host header.");
  }
  if (config.allowInsecureAssetFetch) {
    console.warn("LKTI_INSECURE_ASSET_FETCH=1: private-address protection is OFF. Use only for local testing.");
  }

  const server = http.createServer(toNodeListener(createHandler({ config, registry, pages, tokens })));
  server.requestTimeout = 60_000;
  server.listen(config.port, config.host, () => {
    console.log(`LegendKeeper Token Importer backend ${VERSION} on http://${config.host}:${config.port}`);
    console.log(`Projects: ${config.lkApiKeys.length} key(s) configured; token hosting ${tokens ? "on" : "off"}.`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();
