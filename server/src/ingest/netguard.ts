import dns from "dns/promises";
import net from "net";

/**
 * Outbound guard for every address the server fetches for a user (a film's
 * links, the film agent's WebFetch, a project's site): none of them may reach
 * loopback, the LAN, the cloud metadata endpoint or anything else that is
 * not the public internet.
 */

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["64:ff9b::", 96], // NAT64 can wrap private IPv4
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

/** IPv4-mapped IPv6 (`::ffff:10.0.0.1`, `::ffff:a00:1`) as the IPv4 it wraps, else null. */
const mappedIpv4 = (ip: string): string | null => {
  const m = /^::ffff:(.+)$/i.exec(ip);
  if (!m) return null;
  if (net.isIPv4(m[1])) return m[1];
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
  if (!hex) return null;
  const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
};

export const isPrivateIp = (ip: string): boolean => {
  const v4 = net.isIPv4(ip) ? ip : mappedIpv4(ip);
  if (v4) return blocked.check(v4, "ipv4");
  if (net.isIPv6(ip)) return blocked.check(ip, "ipv6");
  return true; // not an IP at all: refuse
};

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

export class BlockedUrlError extends Error {}

/** Throws unless `host` is a public name or address. */
const assertPublicHost = async (host: string): Promise<void> => {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!bare || PRIVATE_NAMES.test(bare)) throw new BlockedUrlError("Private addresses are not allowed.");
  const addresses = net.isIP(bare)
    ? [{ address: bare }]
    : await dns.lookup(bare, { all: true, verbatim: true }).catch(() => {
        throw new BlockedUrlError(`Could not resolve ${bare}.`);
      });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new BlockedUrlError("Private addresses are not allowed.");
  }
};

/** Parse a user-typed URL (bare domains get https://) and refuse anything non-public. */
export const assertPublicUrl = async (raw: string): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new BlockedUrlError(`"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http(s) URLs are supported.");
  }
  if (url.username || url.password) throw new BlockedUrlError("URLs with credentials are not supported.");
  await assertPublicHost(url.hostname);
  return url;
};
