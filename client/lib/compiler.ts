"use client";

import {
  createBrowserBundler,
  type BrowserBundler,
} from "@remotion/browser-bundler";
import {
  getBrowserComposition,
  loadBrowserBundle,
  type BrowserComposition,
} from "@remotion/browser-bundler/runtime";

export type Preview = Pick<
  BrowserComposition,
  "component" | "durationInFrames" | "fps" | "width" | "height" | "props"
>;

const THREE_VERSION = "0.186.1";
/** esm.sh's own build of three, the module react-three-fiber imports (`/three@<v>/es2022/three.mjs`). */
const THREE_MODULE = `https://esm.sh/three@${THREE_VERSION}/es2022`;

/**
 * A film's `three` imports pointed at the very module react-three-fiber
 * imports. Imported by name, esm.sh serves the film a separate build of three
 * (one per set of externals), so its objects are not fiber's: fiber then
 * assigns where it should copy ("Cannot assign to read only property
 * 'position'") and the film breaks where such a part mounts.
 */
const pinThree = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(files).map(([name, code]) => [
      name,
      /\.[cm]?[jt]sx?$/.test(name)
        ? code
            .replace(/(from\s+|import\s*\(\s*|import\s+)(["'])three\2/g, `$1$2${THREE_MODULE}/three.mjs$2`)
            .replace(/(from\s+|import\s*\(\s*|import\s+)(["'])three\/(?:examples\/jsm|addons)\/([^"']+?)(?:\.js)?\2/g, `$1$2${THREE_MODULE}/examples/jsm/$3.mjs$2`)
        : code,
    ])
  );

/** Versions for the packages the preview fetches (3D scenes, motion films): the same as the renderer's (server/package.json). */
const PREVIEW_DEPENDENCIES: Record<string, string> = {
  remotion: "4.0.533",
  three: THREE_VERSION,
  // fiber's own three pinned to the film's (esm.sh would resolve its peer range to the newest three).
  // @remotion/three isn't fetched: the server sends it as a file of the film (motion-agent vendorRemotionThree),
  // so it shares this one fiber with the film's own `useThree`
  "@react-three/fiber": `9.8.1?deps=three@${THREE_VERSION}`,
  "@remotion/transitions": "4.0.533",
  "@remotion/google-fonts": "4.0.533",
  "@remotion/shapes": "4.0.533",
  "@remotion/paths": "4.0.533",
  "@remotion/noise": "4.0.533",
  "@remotion/layout-utils": "4.0.533",
  "@remotion/motion-blur": "4.0.533",
  "@remotion/media": "4.0.533",
};

let bundler: BrowserBundler | null = null;
let reportProgress: ((message: string) => void) | null = null;

/** One bundler per page: the WebAssembly compiler is expensive to start. */
const getBundler = (): BrowserBundler => {
  if (bundler) return bundler;
  bundler = createBrowserBundler({
    // packages other than React and Remotion come from esm.sh, which would serve "latest" without a pin
    dependencyVersions: PREVIEW_DEPENDENCIES,
    workerUrl: new URL("/compiler/browser-bundler-worker.js", window.location.origin),
    onProgress: (progress) => {
      if (!reportProgress || progress.asset !== "rspack-wasm") return;
      if (progress.totalBytes) {
        reportProgress(
          `Downloading compiler… ${Math.round((progress.loadedBytes / progress.totalBytes) * 100)}%`
        );
      } else {
        reportProgress(`Downloading compiler… ${Math.round(progress.loadedBytes / 1024)} KB`);
      }
    },
  });
  return bundler;
};

/** Compile the generated project in the browser and resolve its composition. */
export async function compileProject(options: {
  files: Record<string, string>;
  compositionId: string;
  /** The bundle's entry (a motion film's is src/index.ts). */
  entryPoint?: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<Preview> {
  reportProgress = options.onProgress ?? null;
  options.onProgress?.("Starting compiler…");

  const bundle = await getBundler().bundle({
    project: { entryPoint: options.entryPoint ?? "src/Root.tsx", files: pinThree(options.files) },
  });
  if (options.signal?.aborted) throw new DOMException("Superseded", "AbortError");

  options.onProgress?.("Loading video…");
  const root = loadBrowserBundle({ bundle });
  return getBrowserComposition({
    root,
    compositionId: options.compositionId,
    inputProps: {},
    signal: options.signal,
  });
}
