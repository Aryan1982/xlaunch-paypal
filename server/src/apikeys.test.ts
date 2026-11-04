import { describe, expect, it } from "vitest";

import { hashKey, isApiKey, keyPrefix, newApiKey } from "./apikeys";

describe("API keys", () => {
  it("makes distinct keys in the expected shape", () => {
    const a = newApiKey();
    const b = newApiKey();
    expect(a).toMatch(/^xl_[A-Za-z0-9_-]{40}$/);
    expect(a).not.toBe(b);
    expect(isApiKey(a)).toBe(true);
  });

  it("tells keys apart from session tokens and junk", () => {
    expect(isApiKey("eyJhbGciOiJFUzI1NiJ9.e30.sig")).toBe(false);
    expect(isApiKey("xl_short")).toBe(false);
    expect(isApiKey(`xl_${"a".repeat(40)}!`)).toBe(false);
  });

  it("stores only a stable SHA-256 hash, and shows only a short prefix", () => {
    const key = newApiKey();
    expect(hashKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(key)).toBe(hashKey(key));
    expect(hashKey(key)).not.toContain(key.slice(3, 13));
    expect(keyPrefix(key)).toHaveLength(10);
    expect(key.startsWith(keyPrefix(key))).toBe(true);
  });
});
