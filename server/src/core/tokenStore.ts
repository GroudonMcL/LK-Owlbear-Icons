// Content-addressed storage for finished token images. Names are the SHA-256
// of the bytes, so repeated uploads are free and a URL can never be guessed
// from a page or resource id.

export type TokenMime = "image/png" | "image/webp";

export const TOKEN_EXTENSIONS: Record<TokenMime, string> = { "image/png": "png", "image/webp": "webp" };
export const TOKEN_FILE_PATTERN = /^([a-f0-9]{64})\.(png|webp)$/;

export class StoreFullError extends Error {}

export interface StoredToken {
  hash: string;
  fileName: string;
  bytes: number;
  /** False when identical bytes were already stored. */
  created: boolean;
}

export interface TokenFile {
  body: ReadableStream<Uint8Array> | Uint8Array;
  size: number;
  mime: TokenMime;
}

export interface TokenStore {
  put(data: Uint8Array, mime: TokenMime): Promise<StoredToken>;
  /** Null when the name is malformed or nothing is stored under it. */
  get(fileName: string): Promise<TokenFile | null>;
  remove(hash: string): Promise<boolean>;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function mimeForFile(fileName: string): TokenMime {
  return fileName.endsWith(".webp") ? "image/webp" : "image/png";
}
