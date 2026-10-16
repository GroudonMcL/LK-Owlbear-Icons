export interface Config {
  host: string;
  port: number;
  /** Bearer tokens accepted from the extension. Not LegendKeeper keys. */
  accessTokens: string[];
  /** One LegendKeeper API key per project. */
  lkApiKeys: string[];
  lkBaseUrl: string;
  /** Origins allowed to call /api, or "*" for any (the access token still applies). */
  allowedOrigins: string[] | "*";
  /** Public URL of this server, used to build token image URLs. */
  publicBaseUrl: string | null;
  /** Whether finished tokens may be hosted by this server (needs a store). */
  tokenHosting: boolean;
  /** Node only: directory for hosted token images. */
  tokenStoreDir: string;
  tokenStoreMaxBytes: number;
  maxTokenUploadBytes: number;
  maxSourceImageBytes: number;
  /** Optional allowlist of hosts (or parent domains) images may be fetched from. */
  assetHostAllowlist: string[] | null;
  /** Test-only: permit http:// and private addresses for image fetches. */
  allowInsecureAssetFetch: boolean;
  /** Requests per minute per access token. */
  rateLimitPerMinute: number;
}

export class ConfigError extends Error {}

const MIN_ACCESS_TOKEN_LENGTH = 24;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number`);
  return n;
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const accessTokens = list(env.LKTI_ACCESS_TOKENS);
  if (accessTokens.length === 0) {
    throw new ConfigError("LKTI_ACCESS_TOKENS is required (comma-separated, each at least 24 characters)");
  }
  for (const token of accessTokens) {
    if (token.length < MIN_ACCESS_TOKEN_LENGTH) {
      throw new ConfigError(`Every LKTI_ACCESS_TOKENS entry must be at least ${MIN_ACCESS_TOKEN_LENGTH} characters`);
    }
  }

  const lkApiKeys = list(env.LK_API_KEYS);
  if (lkApiKeys.length === 0) throw new ConfigError("LK_API_KEYS is required (one LegendKeeper API key per project)");

  const origins = list(env.LKTI_ALLOWED_ORIGINS);
  const allowedOrigins = origins.length === 0 || origins.includes("*") ? "*" : origins.map((o) => o.replace(/\/$/, ""));

  const hosting = (env.LKTI_TOKEN_HOSTING ?? "on").toLowerCase();
  if (!["on", "off"].includes(hosting)) throw new ConfigError("LKTI_TOKEN_HOSTING must be on or off");

  const assetHosts = list(env.LK_ASSET_HOSTS).map((h) => h.toLowerCase().replace(/^\*?\./, ""));

  const publicBaseUrl = env.LKTI_PUBLIC_URL ? env.LKTI_PUBLIC_URL.replace(/\/+$/, "") : null;
  if (publicBaseUrl && !/^https?:\/\//.test(publicBaseUrl)) throw new ConfigError("LKTI_PUBLIC_URL must be an http(s) URL");

  const lkBaseUrl = (env.LK_BASE_URL || "https://www.legendkeeper.com").replace(/\/+$/, "");

  return {
    host: env.HOST || "0.0.0.0",
    port: positiveNumber(env.PORT, 8787, "PORT"),
    accessTokens,
    lkApiKeys,
    lkBaseUrl,
    allowedOrigins,
    publicBaseUrl,
    tokenHosting: hosting === "on",
    tokenStoreDir: env.LKTI_TOKEN_DIR || "./data/tokens",
    tokenStoreMaxBytes: positiveNumber(env.LKTI_TOKEN_STORE_MAX_MB, 1024, "LKTI_TOKEN_STORE_MAX_MB") * 1024 * 1024,
    maxTokenUploadBytes: 6 * 1024 * 1024,
    maxSourceImageBytes:
      positiveNumber(env.LKTI_MAX_SOURCE_IMAGE_MB, 30, "LKTI_MAX_SOURCE_IMAGE_MB") * 1024 * 1024,
    assetHostAllowlist: assetHosts.length ? assetHosts : null,
    allowInsecureAssetFetch: env.LKTI_INSECURE_ASSET_FETCH === "1",
    rateLimitPerMinute: positiveNumber(env.LKTI_RATE_LIMIT_PER_MINUTE, 240, "LKTI_RATE_LIMIT_PER_MINUTE"),
  };
}
