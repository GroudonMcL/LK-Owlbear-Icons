// Private, loopback, link-local and reserved address ranges, as a pure
// function so it runs in Node and in Workers alike.

const V4_BLOCKED: [number, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([a, p]) => [parseV4(a as string)!, p as number]);

const V6_BLOCKED: [bigint, number][] = [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
  ["64:ff9b::", 96], ["100::", 64], ["2002::", 16],
].map(([a, p]) => [parseV6(a as string)!, p as number]);

export function parseV4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export function parseV6(address: string): bigint | null {
  let text = address.toLowerCase();
  // A trailing dotted quad (e.g. ::ffff:127.0.0.1).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    text = text.slice(0, -v4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/** IP family of a literal: 4, 6, or 0 when it is not an IP literal. */
export function ipFamily(host: string): 0 | 4 | 6 {
  if (parseV4(host) !== null) return 4;
  if (host.includes(":") && parseV6(host) !== null) return 6;
  return 0;
}

/** True for addresses an image fetch must never reach; non-IP input is treated as blocked. */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseV4(address);
  if (v4 !== null) {
    return V4_BLOCKED.some(([base, prefix]) => {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return ((v4 & mask) >>> 0) === ((base & mask) >>> 0);
    });
  }
  const v6 = address.includes(":") ? parseV6(address) : null;
  if (v6 === null) return true;
  // IPv4-mapped (::ffff:a.b.c.d): judge by the embedded IPv4 address.
  if (v6 >> 32n === 0xffffn) {
    const n = Number(v6 & 0xffffffffn);
    return isBlockedAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  return V6_BLOCKED.some(([base, prefix]) => {
    const shift = BigInt(128 - prefix);
    return v6 >> shift === base >> shift;
  });
}
