import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractUrls, gatherContext } from "./motion-context";

afterEach(() => vi.unstubAllGlobals());

describe("gatherContext", () => {
  it("reads the brand colours and fonts from the page's stylesheet, accents before greys", async () => {
    const pages: Record<string, { body: string; type: string }> = {
      "https://brand.test/": {
        type: "text/html",
        body: '<html><head><title>Brand</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="https://cdn.other.test/x.css"></head><body style="color:#000;background:#fff"><p>Hi</p></body></html>',
      },
      "https://brand.test/app.css": { type: "text/css", body: ".btn{background:#e8613c;font-family:Geist,sans-serif}.btn:hover{background:#e8613c}.muted{color:#1c1c1e}" },
    };
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      const page = pages[url];
      return page ? new Response(page.body, { headers: { "content-type": page.type } }) : new Response("no", { status: 404 });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));

    const { pages: found, markdown } = await gatherContext(["https://brand.test/"], dir, "p");

    expect(found[0]!.colors[0]).toBe("#e8613c");
    expect(found[0]!.fonts).toContain("Geist");
    expect(markdown).toContain("Accent (brand) colours, from the page and its stylesheets: #e8613c (2x)");
    // another site's stylesheet is not fetched
    expect(requested).not.toContain("https://cdn.other.test/x.css");
  });
});

/** The links a motion request names are what the film's brand (logo, colours, copy) is read from. */
describe("extractUrls", () => {
  it("finds a bare domain on any ending, not only the common ones", () => {
    expect(extractUrls("make for kapshot.cloud")).toEqual(["https://kapshot.cloud"]);
    expect(extractUrls("our shop acme.store, then docs.acme.site/start.")).toEqual(["https://acme.store", "https://docs.acme.site/start"]);
  });

  it("keeps the whole ending instead of a shorter known one inside it", () => {
    expect(extractUrls("see acme.company")).toEqual(["https://acme.company"]);
  });

  it("skips file names and abbreviations", () => {
    expect(extractUrls("edit Video.tsx and logo.png, e.g. with Next.js")).toEqual([]);
  });

  it("keeps explicit links as written", () => {
    expect(extractUrls("make for https://www.kapshot.cloud/pricing")).toEqual(["https://www.kapshot.cloud/pricing"]);
  });
});
