import path from "node:path";

/**
 * Remotion's bundled ffmpeg/ffprobe: the folder they're in, and the env that
 * lets them find their libraries. The package is named for the platform, and
 * on Linux for its C library too (compositor-linux-x64-gnu or -musl).
 */
export const mediaTools = (): { dir: string; env: NodeJS.ProcessEnv } => {
  const base = `@remotion/compositor-${process.platform}-${process.arch}`;
  for (const name of [base, `${base}-gnu`, `${base}-musl`]) {
    try {
      const dir = path.dirname(require.resolve(`${name}/package.json`));
      return { dir, env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } };
    } catch {
      // not this one
    }
  }
  throw new Error(`Remotion's ffmpeg isn't installed (${base}[-gnu|-musl])`);
};
