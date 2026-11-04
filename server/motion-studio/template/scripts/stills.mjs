// Renders review frames of the "Main" composition as JPEGs.
//   node scripts/stills.mjs              -> 9 frames spread over the whole video
//   node scripts/stills.mjs 118 120 122  -> exactly these frames
// Every call writes a new round folder: review/r01, review/r02, ...
import fs from "node:fs";
import path from "node:path";
import { renderStill } from "@remotion/renderer";
import { chromiumOptions, fail, prepare, root } from "./shared.mjs";

try {
  const { serveUrl, browser, composition } = await prepare();
  const last = composition.durationInFrames - 1;

  const requested = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  const frames = requested.length
    ? requested.map((f) => Math.min(last, Math.max(0, Math.round(f))))
    : [...Array.from({ length: 8 }, (_, i) => Math.round(((i + 0.5) * composition.durationInFrames) / 8)), last];

  const reviewDir = path.join(root, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const rounds = fs.readdirSync(reviewDir).filter((d) => /^r\d+$/.test(d));
  const roundDir = path.join(reviewDir, `r${String(rounds.length + 1).padStart(2, "0")}`);
  fs.mkdirSync(roundDir);

  for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
    const output = path.join(roundDir, `f${String(frame).padStart(4, "0")}.jpg`);
    await renderStill({
      serveUrl,
      composition,
      frame,
      output,
      imageFormat: "jpeg",
      jpegQuality: 85,
      scale: 0.5,
      puppeteerInstance: browser,
      chromiumOptions,
      overwrite: true,
    });
    const seconds = (frame / composition.fps).toFixed(2);
    console.log(`frame ${frame} (${seconds}s) -> ${path.relative(root, output)}`);
  }
  await browser.close({ silent: true });
} catch (err) {
  fail(err);
}
