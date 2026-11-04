import { describe, expect, it } from "vitest";

import { assetToken, downloadToken, verifyAssetToken, verifyDownloadToken } from "./sign";

const parse = (token: string) => Object.fromEntries(new URLSearchParams(token)) as { exp: string; sig: string };

describe("signed asset tokens", () => {
  const now = Date.UTC(2026, 9, 8, 10, 0, 0);

  it("verifies for its own project until it expires", () => {
    const { exp, sig } = parse(assetToken("abc123", now));
    expect(verifyAssetToken("abc123", exp, sig, now)).toBe(true);
    expect(verifyAssetToken("abc123", exp, sig, now + 12 * 3600_000)).toBe(true);
    expect(verifyAssetToken("abc123", exp, sig, Number(exp) * 1000)).toBe(false);
  });

  it("is stable within a bucket (keeps the render bundle cache warm)", () => {
    expect(assetToken("abc123", now)).toBe(assetToken("abc123", now + 60 * 60 * 1000));
  });

  it("refuses another project, a tampered expiry or signature, and junk", () => {
    const { exp, sig } = parse(assetToken("abc123", now));
    expect(verifyAssetToken("other", exp, sig, now)).toBe(false);
    expect(verifyAssetToken("abc123", String(Number(exp) + 43200), sig, now)).toBe(false);
    expect(verifyAssetToken("abc123", exp, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"), now)).toBe(false);
    expect(verifyAssetToken("abc123", undefined, undefined, now)).toBe(false);
    expect(verifyAssetToken("abc123", "1e12", sig, now)).toBe(false);
  });
});

describe("signed download tokens", () => {
  const now = Date.UTC(2026, 9, 11, 10, 0, 0);

  it("verifies for its own project until exactly its expiry", () => {
    const { query, expiresAt } = downloadToken("abc123", now, 60_000);
    const { exp, sig } = parse(query);
    expect(expiresAt).toBe(now + 60_000);
    expect(verifyDownloadToken("abc123", exp, sig, now)).toBe(true);
    expect(verifyDownloadToken("abc123", exp, sig, now + 59_000)).toBe(true);
    expect(verifyDownloadToken("abc123", exp, sig, now + 60_000)).toBe(false);
    expect(verifyDownloadToken("other", exp, sig, now)).toBe(false);
  });

  it("never crosses scopes: an asset token cannot download, a download token cannot read assets", () => {
    const asset = parse(assetToken("abc123", now));
    expect(verifyDownloadToken("abc123", asset.exp, asset.sig, now)).toBe(false);
    const download = parse(downloadToken("abc123", now).query);
    expect(verifyAssetToken("abc123", download.exp, download.sig, now)).toBe(false);
  });
});
