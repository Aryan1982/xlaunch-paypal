import { describe, expect, it } from "vitest";

import { assertPublicUrl, isPrivateIp } from "./netguard";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe", // 169.254.169.254, hex-mapped
    "64:ff9b::a00:1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "104.16.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isPrivateIp(ip)).toBe(false)
  );
});

describe("assertPublicUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:3002/api/projects",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost:3002",
    "http://printer.local",
    "http://db.internal",
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:pass@example.com",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });
});
