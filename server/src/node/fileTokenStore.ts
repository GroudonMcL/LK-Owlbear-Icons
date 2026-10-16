import { randomBytes } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  mimeForFile,
  sha256Hex,
  StoreFullError,
  TOKEN_EXTENSIONS,
  TOKEN_FILE_PATTERN,
  type StoredToken,
  type TokenFile,
  type TokenMime,
  type TokenStore,
} from "../core/tokenStore.js";

/** Token images on the local disk, for self-hosting on a VPS or container. */
export class FileTokenStore implements TokenStore {
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

  async put(data: Uint8Array, mime: TokenMime): Promise<StoredToken> {
    const hash = await sha256Hex(data);
    const fileName = `${hash}.${TOKEN_EXTENSIONS[mime]}`;
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

  async get(fileName: string): Promise<TokenFile | null> {
    if (!TOKEN_FILE_PATTERN.test(fileName)) return null;
    const file = path.join(this.dir, fileName);
    try {
      const { size } = await fs.stat(file);
      return {
        body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
        size,
        mime: mimeForFile(fileName),
      };
    } catch {
      return null;
    }
  }

  async remove(hash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    let removed = false;
    for (const ext of Object.values(TOKEN_EXTENSIONS)) {
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
