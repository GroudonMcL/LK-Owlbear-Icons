export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const c = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  return toHex({ r: c.r + (target - c.r) * t, g: c.g + (target - c.g) * t, b: c.b + (target - c.b) * t });
}

export function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
