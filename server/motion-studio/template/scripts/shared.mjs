import path from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, selectComposition } from "@remotion/renderer";

export const root = process.cwd();
export const COMPOSITION_ID = "Main";

export const chromiumOptions = process.env.REMOTION_GL ? { gl: process.env.REMOTION_GL } : {};

export async function prepare() {
  const serveUrl = await bundle({
    entryPoint: path.join(root, "src/index.ts"),
    rootDir: root,
    publicDir: path.join(root, "public"),
  });
  const browser = await openBrowser("chrome", { chromiumOptions });
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    puppeteerInstance: browser,
    chromiumOptions,
  });
  return { serveUrl, browser, composition };
}

export function fail(err) {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
