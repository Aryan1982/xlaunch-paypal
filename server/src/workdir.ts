import fs from "fs/promises";
import path from "path";

import { projectDir } from "./store";
import { deleteObjects, getObject, projectObjects, putObject, StorageCapError, storageEnabled } from "./storage";

/**
 * A project's working directory on this server is a cache; its durable copy
 * is in R2 (storage.ts). After work changes a project, `syncProject` uploads
 * what changed; before work reads it, `ensureWorkdir` restores whatever this
 * disk is missing (a fresh VPS).
 *
 * Synced: crawled assets (assets/), a motion film's workspace (motion/: its
 * brief, research, plan, code, public files such as its recorded narration in
 * public/voice, and review frames; the template's tooling and the sound library in public/sfx come back from the server), the
 * scene code of films from the retired scene studio (src/scenes, src/screens:
 * kept as stored, nothing builds them any more) and the thumbnail. Exported
 * MP4s are stored too, but on their own terms (storeRender, below).
 */

const SYNCED = [
  /^assets\/[^/]+$/,
  /^src\/scenes\/[^/]+$/,
  /^src\/screens\/[^/]+$/,
  /^motion\/(?:BRIEF\.md|PLAN\.md|context\.md|src\/.+|public\/(?!sfx\/).+|review\/r\d+\/f\d+\.jpg)$/,
  /^thumbnail\.jpg$/,
];
const MANIFEST = ".synced.json";

type Manifest = Record<string, { size: number; mtimeMs: number }>;

const keyOf = (id: string, rel: string): string => `projects/${id}/${rel}`;

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".json": "application/json",
};

const walk = async (root: string, dir = ""): Promise<string[]> => {
  const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, rel)));
    else if (SYNCED.some((re) => re.test(rel))) out.push(rel);
  }
  return out;
};

const readManifest = async (id: string): Promise<Manifest | null> => {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir(id), MANIFEST), "utf8")) as Manifest;
  } catch {
    return null;
  }
};

const writeManifest = async (id: string, manifest: Manifest): Promise<void> => {
  await fs.mkdir(projectDir(id), { recursive: true });
  await fs.writeFile(path.join(projectDir(id), MANIFEST), JSON.stringify(manifest), "utf8");
};

const syncing = new Map<string, Promise<void>>();

/** Upload what changed since the last sync and delete what was removed. Never throws. */
export const syncProject = (id: string, userId: string | null | undefined): Promise<void> => {
  if (!storageEnabled()) return Promise.resolve();
  const previous = syncing.get(id) ?? Promise.resolve();
  const next = previous.then(async () => {
    try {
      const root = projectDir(id);
      const manifest = (await readManifest(id)) ?? {};
      const files = await walk(root);
      for (const rel of files) {
        const stat = await fs.stat(path.join(root, rel)).catch(() => null);
        if (!stat) continue;
        const known = manifest[rel];
        if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) continue;
        await putObject(keyOf(id, rel), await fs.readFile(path.join(root, rel)), {
          projectId: id,
          userId: userId ?? null,
          contentType: CONTENT_TYPES[path.extname(rel).toLowerCase()],
        });
        manifest[rel] = { size: stat.size, mtimeMs: stat.mtimeMs };
      }
      const gone = Object.keys(manifest).filter((rel) => !files.includes(rel));
      await deleteObjects(gone.map((rel) => keyOf(id, rel)));
      for (const rel of gone) delete manifest[rel];
      await writeManifest(id, manifest);
    } catch (error) {
      const why = error instanceof StorageCapError ? error.message : error instanceof Error ? error.message : String(error);
      console.error(`[workdir] sync of ${id} incomplete: ${why}`);
    }
  });
  syncing.set(id, next);
  void next.finally(() => {
    if (syncing.get(id) === next) syncing.delete(id);
  });
  return next;
};

const restoring = new Map<string, Promise<void>>();

/** Restore a project's files from R2 if this disk has never seen them. */
export const ensureWorkdir = (id: string): Promise<void> => {
  if (!storageEnabled()) return Promise.resolve();
  const inflight = restoring.get(id);
  if (inflight) return inflight;
  const work = (async () => {
    if (await readManifest(id)) return;
    const objects = await projectObjects(id);
    const manifest: Manifest = {};
    const prefix = keyOf(id, "");
    for (const object of objects) {
      const rel = object.key.slice(prefix.length);
      if (!SYNCED.some((re) => re.test(rel))) continue;
      const file = path.join(projectDir(id), rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, await getObject(object.key));
      const stat = await fs.stat(file);
      manifest[rel] = { size: stat.size, mtimeMs: stat.mtimeMs };
    }
    await writeManifest(id, manifest);
  })().finally(() => restoring.delete(id));
  restoring.set(id, work);
  return work;
};

/**
 * Restore one synced file (the thumbnail for a project list) without pulling
 * the whole project. The manifest is left alone: the next ensureWorkdir still
 * restores everything. Never throws; the caller checks for the file.
 */
export const restoreFile = async (id: string, rel: string): Promise<void> => {
  if (!storageEnabled() || !SYNCED.some((re) => re.test(rel))) return;
  const file = path.join(projectDir(id), rel);
  if (await fs.access(file).then(() => true, () => false)) return;
  await restoring.get(id)?.catch(() => undefined);
  try {
    const body = await getObject(keyOf(id, rel));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  } catch {
    // not stored: the caller answers 404
  }
};

// ---------------------------------------------------------------------------
// Exported MP4s. Kept apart from SYNCED: ensureWorkdir restores every synced
// file whenever a project is opened, and pulling each video down just to
// preview a project would waste bandwidth and class B operations. An export is
// uploaded once when it finishes and restored only when someone downloads it.
// ---------------------------------------------------------------------------

/** Upload a finished export; returns its key, or null when storage is off or full (the local file still serves). */
export const storeRender = async (id: string, userId: string | null | undefined, file: string, stamp: number): Promise<string | null> => {
  if (!storageEnabled()) return null;
  const key = keyOf(id, `renders/video-${stamp}.mp4`);
  try {
    await putObject(key, await fs.readFile(file), { projectId: id, userId: userId ?? null, contentType: "video/mp4" });
    return key;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(`[workdir] export of ${id} not stored: ${why}`);
    return null;
  }
};

const restoringRenders = new Map<string, Promise<void>>();

/**
 * Bring a stored export back to this disk. Written beside the target and
 * renamed into place, so a download running at the same time never streams a
 * half-written file. Never throws; the caller checks for the file.
 */
export const restoreRender = (key: string, file: string): Promise<void> => {
  if (!storageEnabled()) return Promise.resolve();
  const inflight = restoringRenders.get(file);
  if (inflight) return inflight;
  const work = (async () => {
    const part = `${file}.part`;
    try {
      const body = await getObject(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(part, body);
      await fs.rename(part, file);
    } catch {
      await fs.rm(part, { force: true }).catch(() => undefined);
      // gone from storage: the caller answers 404
    }
  })().finally(() => restoringRenders.delete(file));
  restoringRenders.set(file, work);
  return work;
};

/**
 * Delete every stored export of a project except `keep`. Looks the keys up
 * rather than trusting project.render: edits reset the render state and would
 * otherwise orphan the previous video. Never throws.
 */
export const dropRenders = async (id: string, keep: string | null): Promise<void> => {
  if (!storageEnabled()) return;
  try {
    const prefix = keyOf(id, "renders/");
    const stale = (await projectObjects(id)).map((o) => o.key).filter((key) => key.startsWith(prefix) && key !== keep);
    await deleteObjects(stale);
  } catch (error) {
    console.error(`[workdir] could not delete old exports of ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
