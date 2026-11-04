import fs from "fs/promises";
import path from "path";

import { getProject, rendersDir, updateProject } from "../store";
import { assertFilmAgent } from "../lib/retired";
import { renderMotion } from "./motion-agent";
import { Semaphore } from "../lib/semaphore";
import { dropRenders, ensureWorkdir, storeRender } from "../workdir";

const rendering = new Set<string>();
/** Exports at once across all projects: each is a headless Chrome with several tabs. */
const renders = new Semaphore(Math.max(1, Number(process.env.MAX_RENDERS ?? 1)));

export const isRendering = (id: string): boolean => rendering.has(id);

/** A running (or queued) export's stop switch, per project. */
const renderStops = new Map<string, { stopped: boolean; cancel: (() => void) | null }>();

/** Stop the project's export while it is still rendering. False when there is none to stop. */
export const stopRender = (id: string): boolean => {
  const stop = renderStops.get(id);
  if (!stop || stop.stopped) return false;
  stop.stopped = true;
  stop.cancel?.();
  return true;
};

class RenderStopped extends Error {}
/** Projects with an export running or queued. */
export const renderingProjects = (): string[] => Array.from(rendering);

export const renderFile = (id: string): string => path.join(rendersDir(id), "video.mp4");

/** Render the finished composition to MP4. Progress is persisted on the project. */
export async function runRender(id: string): Promise<void> {
  if (rendering.has(id)) throw new Error("A render is already running.");
  const project = await getProject(id);
  // a film from the retired scene studio has no source to render any more
  assertFilmAgent(project);
  if (project.stage !== "ready") throw new Error("The video is not ready to render yet.");
  rendering.add(id);
  const stop = { stopped: false, cancel: null as (() => void) | null };
  renderStops.set(id, stop);

  await updateProject(id, (p) => {
    p.render = { state: "running", progress: 0, startedAt: Date.now() };
  });

  let release: (() => void) | null = null;
  try {
    release = await renders.acquire((ahead) =>
      void updateProject(id, (p) => {
        if (ahead > 0) p.render = { ...p.render, state: "running", progress: 0 };
      }).catch(() => undefined)
    );
    if (stop.stopped) throw new RenderStopped();
    await ensureWorkdir(id);
    const output = renderFile(id);
    await fs.mkdir(rendersDir(id), { recursive: true });

    // the film renders from its agent's workspace, with its own renderer script
    const cancel = new AbortController();
    stop.cancel = () => cancel.abort();
    let lastReport = 0;
    await renderMotion(
      id,
      output,
      (progress) => {
        const now = Date.now();
        if (now - lastReport < 400 && progress < 1) return;
        lastReport = now;
        void updateProject(id, (p) => {
          p.render.progress = progress;
        });
      },
      cancel.signal
    );
    if (stop.stopped) throw new RenderStopped();

    // past this point the export is finished: a stop arriving now changes nothing
    renderStops.delete(id);
    const finishedAt = Date.now();
    await updateProject(id, (p) => {
      p.render = { state: "done", progress: 1, file: "video.mp4", finishedAt, startedAt: p.render.startedAt };
    });
    // The video already downloads from this disk; free the renderer for the
    // next export before the upload. isRendering stays true until the upload
    // is done, so no edit can change the version underneath it.
    release?.();
    release = null;
    // Storing is best effort: a failure here must not turn a finished export into an error.
    const stored = await storeRender(id, project.userId, output, finishedAt);
    if (stored) {
      await updateProject(id, (p) => {
        if (p.render.state === "done" && p.render.finishedAt === finishedAt) p.render.stored = stored;
      }).catch((error) => console.error(`[render] could not record stored export of ${id}:`, error));
    }
    await dropRenders(id, stored);
  } catch (error) {
    if (stop.stopped) {
      await fs.rm(renderFile(id), { force: true }).catch(() => undefined);
      await updateProject(id, (p) => {
        p.render = { state: "idle", progress: 0, stopped: true };
      });
      return;
    }
    await updateProject(id, (p) => {
      p.render = {
        state: "error",
        progress: 0,
        error: error instanceof Error ? error.message.slice(0, 800) : String(error),
      };
    });
  } finally {
    renderStops.delete(id);
    release?.();
    rendering.delete(id);
  }
}
