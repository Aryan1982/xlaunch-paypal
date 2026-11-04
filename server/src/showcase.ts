import { execFile } from "child_process";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

import { z } from "zod";

import { config } from "./config";
import { db, dbEnabled } from "./db";
import { mediaTools } from "./lib/media-tools";
import { getObject, storageEnabled } from "./storage";

/**
 * Example videos on the home and login pages.
 *
 * Curated (the normal case): the `showcase_videos` table (db/005), managed from
 * the Accessboard CMS: each row says whether the video is on the home page
 * and/or the login page, and in what order; its MP4 lives in R2 and is fetched
 * once per version into a local cache, then served from disk.
 *
 * Fallback (no table, nothing curated, or no database: local runs): a folder
 * of MP4s (SHOWCASE_DIR; by default the sibling Remotion project's out/
 * folder). A name containing "lowpoly" is a 3D video; anything else is 2D.
 * Names ending in "old" are skipped, and of two files whose names differ only
 * in case or punctuation the newer one is kept.
 *
 * Posters (both kinds) are made here from the video: a frame where the
 * picture has settled (see `stillAt`), not a fixed time, which in a kinetic
 * title lands mid-sentence.
 */

const run = promisify(execFile);

/** Where an example is shown. */
export type ShowcasePlace = "home" | "login";

export type ShowcaseItem = {
  id: string;
  title: string;
  mode: "2d" | "3d";
  width: number;
  height: number;
  seconds: number;
  /** Changes when the file does, for cache busting. */
  version: number;
  /** When it was added (ISO), for the examples page's video structured data. */
  uploadedAt: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/;

export const showcaseDir = (): string =>
  path.resolve(process.env.SHOWCASE_DIR || path.resolve(__dirname, "../../../video/out"));

const posterDir = () => path.join(config.dataDir, "showcase-posters");

export const modeOf = (name: string): "2d" | "3d" => (/low-?poly/i.test(name) ? "3d" : "2d");

/** A readable title from a file name: "ExcelDashLaunch" → "Excel Dash", "xlaunch-square-ad" → "Xlaunch square ad". */
export const titleOf = (name: string): string => {
  const base = name
    .replace(/^low-?poly$/i, "")
    .replace(/[-_ ](?:low-?poly|launch)$/i, "")
    .replace(/(?<=[A-Za-z0-9])(?:LowPoly|Launch)$/, "")
    .replace(/[-_ ]+/g, " ")
    .replace(/([a-z])(?=[A-Z][a-z])/g, "$1 ")
    .trim();
  if (!base) return modeOf(name) === "3d" ? "Low poly" : "Untitled";
  return base[0]!.toUpperCase() + base.slice(1);
};

const probe = async (file: string): Promise<{ width: number; height: number; seconds: number }> => {
  const { dir, env } = mediaTools();
  const { stdout } = await run(
    path.join(dir, "ffprobe"),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
    { env }
  );
  const json = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  return {
    width: Number(json.streams?.[0]?.width ?? 1920),
    height: Number(json.streams?.[0]?.height ?? 1080),
    seconds: Number(json.format?.duration ?? 0),
  };
};

const probed = new Map<string, { version: number; meta: Awaited<ReturnType<typeof probe>> }>();

// ---------------------------------------------------------------------------
// Curated (database + R2)
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  title: string;
  mode: "2d" | "3d";
  width: number;
  height: number;
  seconds: number;
  video_key: string;
  on_home: boolean;
  on_login: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

const FRESH_MS = 60_000;
let rows: { at: number; list: Row[] | null } | null = null;
let reading: Promise<Row[] | null> | null = null;

/** Every curated row (shown or not), at most a minute old; null when there is no table or database. */
const curatedRows = async (force = false): Promise<Row[] | null> => {
  if (!dbEnabled() || !storageEnabled()) return null;
  if (!force && rows && Date.now() - rows.at < FRESH_MS) return rows.list;
  reading ??= (async () => {
    const { data, error } = await db()
      .from("showcase_videos")
      .select("id, title, mode, width, height, seconds, video_key, on_home, on_login, position, created_at, updated_at")
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    // no table yet (an older database): the folder stays in use
    const list = error ? null : ((data ?? []) as Row[]);
    rows = { at: Date.now(), list };
    return list;
  })().finally(() => {
    reading = null;
  });
  return reading;
};

const itemOf = (r: Row): ShowcaseItem => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  width: Number(r.width),
  height: Number(r.height),
  seconds: Number(r.seconds),
  version: Date.parse(r.updated_at) || 0,
  uploadedAt: new Date(r.created_at).toISOString(),
});

const cacheDir = () => path.join(config.dataDir, "showcase-cache");
const fetching = new Map<string, Promise<string | null>>();

/** A curated MP4 on local disk: fetched from R2 once per version (one class B op), then served from disk. */
const cachedVideo = (row: Row): Promise<string | null> => {
  const out = path.join(cacheDir(), `${row.id}-${Date.parse(row.updated_at) || 0}.mp4`);
  let job = fetching.get(out);
  if (job) return job;
  job = (async () => {
    if ((await fs.stat(out).catch(() => null))?.isFile()) return out;
    await fs.mkdir(cacheDir(), { recursive: true });
    const body = await getObject(row.video_key);
    const part = `${out}.part`;
    await fs.writeFile(part, body);
    await fs.rename(part, out);
    // older versions of the same example are no longer needed
    for (const f of await fs.readdir(cacheDir()).catch(() => [] as string[])) {
      if (f.startsWith(`${row.id}-`) && f.endsWith(".mp4") && path.join(cacheDir(), f) !== out) await fs.rm(path.join(cacheDir(), f), { force: true });
    }
    return out;
  })()
    .catch((error) => {
      console.error(`[showcase] fetching ${row.id}.mp4 failed:`, error);
      return null;
    })
    .finally(() => fetching.delete(out));
  fetching.set(out, job);
  return job;
};

/** A curated example by id (re-reading the table once if it isn't known yet: a video added a moment ago). */
const curatedById = async (id: string): Promise<Row | null> => {
  const list = await curatedRows();
  if (!list) return null;
  return list.find((r) => r.id === id) ?? (await curatedRows(true))?.find((r) => r.id === id) ?? null;
};

/**
 * The examples for a place, in the order set in the CMS: the curated ones when
 * any are chosen for it, else the folder's (newest first).
 */
export const listShowcase = async (place: ShowcasePlace = "home"): Promise<ShowcaseItem[]> => {
  const list = await curatedRows();
  const chosen = list?.filter((r) => (place === "login" ? r.on_login : r.on_home)) ?? [];
  if (chosen.length) return chosen.map(itemOf);
  return folderShowcase();
};

// ---------------------------------------------------------------------------
// Fallback: a folder of MP4s
// ---------------------------------------------------------------------------

/** Every example in the folder, newest first. An unreadable or missing folder is an empty list. */
const folderShowcase = async (): Promise<ShowcaseItem[]> => {
  const dir = showcaseDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const files: Array<{ id: string; version: number }> = [];
  for (const file of names) {
    if (!file.toLowerCase().endsWith(".mp4")) continue;
    const id = file.slice(0, -4);
    if (!ID.test(id) || /old$/i.test(id)) continue;
    const stat = await fs.stat(path.join(dir, file)).catch(() => null);
    if (stat?.isFile()) files.push({ id, version: Math.floor(stat.mtimeMs) });
  }
  files.sort((a, b) => b.version - a.version);
  const seen = new Set<string>();
  const items: ShowcaseItem[] = [];
  for (const f of files) {
    const key = f.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    let hit = probed.get(f.id);
    if (hit?.version !== f.version) {
      const meta = await probe(path.join(dir, `${f.id}.mp4`)).catch(() => null);
      if (!meta) continue;
      hit = { version: f.version, meta };
      probed.set(f.id, hit);
    }
    items.push({ id: f.id, title: titleOf(f.id), mode: modeOf(f.id), ...hit.meta, version: f.version, uploadedAt: new Date(f.version).toISOString() });
  }
  return items;
};

/** The MP4 for an example, or null. */
export const showcaseVideo = async (id: string): Promise<string | null> => {
  if (!ID.test(id)) return null;
  const row = await curatedById(id);
  if (row) return cachedVideo(row);
  const file = path.join(showcaseDir(), `${id}.mp4`);
  return (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
};

/**
 * When to take the poster: the frame with the most on screen (mean edge
 * strength) that is also held still (no block of it changing in the 0.6 s
 * either side), so a line of text has finished typing in rather than
 * stopping at "The interview went". Read from 96×54 grey frames at 10 fps,
 * enough to see text arrive; looked for after the first second and within the
 * first 60% of the video (at most 24 s). A video too short to read gets a
 * third of the way in.
 */
const stillAt = async (video: string, seconds: number): Promise<number> => {
  const [w, h, fps] = [96, 54, 10];
  const { dir, env } = mediaTools();
  const { stdout } = await run(
    path.join(dir, "ffmpeg"),
    ["-v", "error", "-t", Math.min(seconds * 0.6, 24).toFixed(2), "-i", video, "-vf", `scale=${w}:${h},format=gray`, "-r", String(fps), "-c:v", "rawvideo", "-f", "image2pipe", "-"],
    { env, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }
  );
  const size = w * h;
  const count = Math.floor(stdout.length / size);
  if (count <= fps) return seconds / 3;
  const edges: number[] = [];
  // change[i]: how much frame i differs from the one before, in its most changed 8×6 block, so one caption
  // word or typed character arriving counts in full (a whole-frame mean would barely move)
  const [bw, bh] = [8, 6];
  const change: number[] = [0];
  for (let i = 0; i < count; i++) {
    const f = stdout.subarray(i * size, (i + 1) * size);
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = f[y * w + x]!;
        if (x + 1 < w) sum += Math.abs(f[y * w + x + 1]! - p);
        if (y + 1 < h) sum += Math.abs(f[(y + 1) * w + x]! - p);
      }
    }
    edges.push(sum / size);
    if (i > 0) {
      const before = stdout.subarray((i - 1) * size, i * size);
      let most = 0;
      for (let by = 0; by < h; by += bh) {
        for (let bx = 0; bx < w; bx += bw) {
          let diff = 0;
          for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) diff += Math.abs(f[y * w + x]! - before[y * w + x]!);
          most = Math.max(most, diff / (bw * bh));
        }
      }
      change.push(most);
    }
  }
  const near = Math.round(fps * 0.6);
  let best = fps;
  let bestScore = -1;
  for (let i = fps; i < count; i++) {
    let motion = 0;
    for (let j = Math.max(1, i - near); j <= Math.min(count - 1, i + near); j++) motion = Math.max(motion, change[j]!);
    const score = edges[i]! / (1 + motion / 2);
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best / fps;
};

const posting = new Map<string, Promise<string | null>>();
// one poster at a time: an empty cache is asked for every poster at once, and each reads seconds of video
let posterQueue: Promise<unknown> = Promise.resolve();

/** A JPEG still where the picture has settled, made once per file version and cached. */
export const showcasePoster = async (id: string): Promise<string | null> => {
  const video = await showcaseVideo(id);
  if (!video) return null;
  const version = Math.floor((await fs.stat(video)).mtimeMs);
  const out = path.join(posterDir(), `${id}-${version}.jpg`);
  if ((await fs.stat(out).catch(() => null))?.isFile()) return out;
  let job = posting.get(out);
  if (!job) {
    job = posterQueue
      .then(async () => {
        await fs.mkdir(posterDir(), { recursive: true });
        const { dir, env } = mediaTools();
        const meta = probed.get(id)?.meta ?? (await probe(video));
        const at = await stillAt(video, meta.seconds);
        const part = `${out}.part.jpg`;
        await run(path.join(dir, "ffmpeg"), ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", part], { env });
        await fs.rename(part, out);
        return out;
      })
      .catch((error) => {
        console.error(`[showcase] poster for ${id} failed:`, error);
        return null;
      })
      .finally(() => posting.delete(out));
    posting.set(out, job);
    posterQueue = job;
  }
  return job;
};

/** The motion films shown while a motion film is being made: picked by hand, shipped with the server. */
export const MOTION_SHOWCASE_DIR = path.resolve(__dirname, "..", "assets", "motion-showcase");

export type MotionShowcaseItem = { id: string; title: string; note: string; seconds: number; aspect: "16:9" | "9:16" | "1:1" };

const MotionShowcaseSchema = z.array(
  z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), title: z.string(), note: z.string(), seconds: z.number(), aspect: z.enum(["16:9", "9:16", "1:1"]) })
);

let motionFilms: MotionShowcaseItem[] | null = null;

export const motionShowcase = (): MotionShowcaseItem[] =>
  (motionFilms ??= MotionShowcaseSchema.parse(JSON.parse(readFileSync(path.join(MOTION_SHOWCASE_DIR, "films.json"), "utf8"))));
