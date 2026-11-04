// Renders the final MP4. Prints machine-readable progress lines:
//   PROGRESS {"progress":0.42}
//   DONE {"output":"out/video.mp4"}
import fs from "node:fs";
import path from "node:path";
import { renderMedia } from "@remotion/renderer";
import { chromiumOptions, fail, prepare, root } from "./shared.mjs";

try {
  const output = path.resolve(root, process.argv[2] ?? "out/video.mp4");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const { serveUrl, browser, composition } = await prepare();

  let lastReported = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    x264Preset: "slow",
    outputLocation: output,
    puppeteerInstance: browser,
    chromiumOptions,
    overwrite: true,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== lastReported) {
        lastReported = pct;
        console.log(`PROGRESS ${JSON.stringify({ progress })}`);
      }
    },
  });
  await browser.close({ silent: true });
  console.log(`DONE ${JSON.stringify({ output: path.relative(root, output) })}`);
} catch (err) {
  fail(err);
}
