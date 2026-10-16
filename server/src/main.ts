import http from "node:http";
import { createApp, VERSION } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { LkClient } from "./lk/client.js";
import { PageService, ProjectRegistry } from "./services.js";
import { TokenStore } from "./tokenStore.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
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
  });

  let tokens: TokenStore | null = null;
  if (config.tokenStoreDir) {
    tokens = new TokenStore(config.tokenStoreDir, config.tokenStoreMaxBytes);
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

  const server = http.createServer(createApp({ config, registry, pages, tokens }));
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
