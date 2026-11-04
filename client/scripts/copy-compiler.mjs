import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const dist = path.join(
  path.dirname(
    require.resolve("@remotion/browser-bundler/package.json")
  ),
  "dist"
);

const target = path.join(process.cwd(), "public", "compiler");

await mkdir(target, { recursive: true });

for (const asset of [
  "browser-bundler-worker.js",
  "rspack.wasm32-wasi.wasm",
  "wasi-worker-browser.mjs",
]) {
  await copyFile(
    path.join(dist, asset),
    path.join(target, asset)
  );
}

console.log("Copied Remotion browser-bundler compiler assets.");
