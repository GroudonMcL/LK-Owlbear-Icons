// Content-addressed storage for finished token images. Files are named by the
// SHA-256 of their bytes, so repeated uploads of the same token are free and a
// URL can never be guessed from a page or resource id.

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type TokenMime = "image/png" | "image/webp";

const EXTENSIONS: Record<TokenMime, string> = { "image/png": "png", "image/webp": "webp" };
export const TOKEN_FILE_PATTERN = /^([a-f0-9]{64})\.(png|webp)$/;

export class StoreFullError extends Error {}

export interface StoredToken {
  hash: string;
  fileName: string;
  bytes: number;
  created: boolean;
}

export class TokenStore {
  private usedBytes = 0;

  constructor(
    readonly dir: string,
    private readonly maxBytes: number,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    let used = 0;
    for (const name of await fs.readdir(this.dir)) {
      if (name.endsWith(".tmp")) {
        await fs.rm(path.join(this.dir, name), { force: true });
        continue;
      }
      if (!TOKEN_FILE_PATTERN.test(name)) continue;
      used += (await fs.stat(path.join(this.dir, name))).size;
    }
    this.usedBytes = used;
  }

  async put(data: Buffer, mime: TokenMime): Promise<StoredToken> {
    const hash = createHash("sha256").update(data).digest("hex");
    const fileName = `${hash}.${EXTENSIONS[mime]}`;
    const target = path.join(this.dir, fileName);
    try {
      await fs.access(target);
      return { hash, fileName, bytes: data.length, created: false };
    } catch {
      // Not stored yet.
    }
    if (this.usedBytes + data.length > this.maxBytes) throw new StoreFullError("Token storage is full");
    const tmp = path.join(this.dir, `${hash}.${randomBytes(6).toString("hex")}.tmp`);
    await fs.writeFile(tmp, data, { flag: "wx" });
    await fs.rename(tmp, target);
    this.usedBytes += data.length;
    return { hash, fileName, bytes: data.length, created: true };
  }

  /** Absolute path for a public file name, or null if the name is not a token file. */
  resolve(fileName: string): string | null {
    return TOKEN_FILE_PATTERN.test(fileName) ? path.join(this.dir, fileName) : null;
  }

  async remove(hash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    let removed = false;
    for (const ext of Object.values(EXTENSIONS)) {
      const file = path.join(this.dir, `${hash}.${ext}`);
      try {
        const { size } = await fs.stat(file);
        await fs.rm(file);
        this.usedBytes -= size;
        removed = true;
      } catch {
        // Already gone.
      }
    }
    return removed;
  }
}
