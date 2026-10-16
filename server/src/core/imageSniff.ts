// Identify image formats from their bytes rather than trusting Content-Type.

export type RasterMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";

export function sniffImageMime(buf: Uint8Array): RasterMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && ascii(buf, 0, 6).match(/^GIF8[79]a$/)) return "image/gif";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "image/webp";
  if (buf.length >= 12 && ascii(buf, 4, 4) === "ftyp" && /^avi[fs]$/.test(ascii(buf, 8, 4))) return "image/avif";
  return null;
}

function ascii(buf: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...buf.subarray(start, start + length));
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Width/height of a PNG or WebP, read from its header. */
export function readDimensions(buf: Uint8Array, mime: RasterMime): ImageDimensions | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (mime === "image/png") {
    if (buf.length < 24 || ascii(buf, 12, 4) !== "IHDR") return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/webp") {
    if (buf.length < 30) return null;
    const chunk = ascii(buf, 12, 4);
    if (chunk === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
    if (chunk === "VP8L") {
      if (buf[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") {
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }
  return null;
}
