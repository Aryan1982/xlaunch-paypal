import fs from "fs/promises";
import { Stopped, stopRequested } from "./lib/calls";
import path from "path";
import { EventEmitter } from "events";
import { customAlphabet } from "nanoid";

import { config } from "./config";
import { db, dbEnabled, must } from "./db";
import { HttpError, PROJECT_ID } from "./lib/http";
import { DEFAULT_AUDIO, type Aspect, type Project, type ProjectOptions } from "./types";

const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

const cache = new Map<string, Project>();
const writes = new Map<string, Promise<void>>();
const bus = new EventEmitter();
bus.setMaxListeners(0);

export const projectDir = (id: string): string =>
  path.resolve(config.dataDir, "projects", id);
export const assetsDir = (id: string): string =>
  path.join(projectDir(id), "assets");
export const rendersDir = (id: string): string =>
  path.join(projectDir(id), "renders");

const jsonFile = (id: string): string => path.join(projectDir(id), "project.json");

export const assertId = (id: string): string => {
  if (!PROJECT_ID.test(id)) {
    throw new HttpError(400, `"${id}" is not a valid project id.`);
  }
  return id;
};

// ---------------------------------------------------------------------------
// Persistence. With the database configured, the project document lives in
// the `projects` table and this disk is only a working cache (workdir.ts);
// without it (local dev, tests), project.json in data/projects/<id>.
// ---------------------------------------------------------------------------

const writeFile = async (project: Project): Promise<void> => {
  await fs.mkdir(projectDir(project.id), { recursive: true });
  const tmp = `${jsonFile(project.id)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), "utf8");
  await fs.rename(tmp, jsonFile(project.id));
};

const writeRow = async (project: Project): Promise<void> => {
  if (!project.userId) throw new Error(`Project ${project.id} has no owner.`);
  must(
    await db()
      .from("projects")
      .upsert({
        id: project.id,
        user_id: project.userId,
        url: project.url,
        title: project.title,
        stage: project.stage,
        data: project,
        created_at: new Date(project.createdAt).toISOString(),
        updated_at: new Date(project.updatedAt).toISOString(),
      }),
    `save project ${project.id}`
  );
};

/** Serialised per project so writes never land out of order. */
const write = (project: Project): Promise<void> => {
  const previous = writes.get(project.id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => (dbEnabled() ? writeRow(project) : writeFile(project)));
  writes.set(project.id, next);
  return next;
};

/**
 * Coalesce bursts: streamed thinking (~2/s) and render progress (~2.5/s)
 * update the project constantly, and every update must not be a database
 * write. Changes of stage or error, and anything without a pending write, go
 * out at once; the rest within DEBOUNCE_MS. SSE listeners get every update
 * from memory regardless.
 */
const DEBOUNCE_MS = 1_500;
const pending = new Map<string, NodeJS.Timeout>();
const lastWritten = new Map<string, string>();

const persist = (project: Project): Promise<void> => {
  const marker = `${project.stage}|${project.error ?? ""}|${project.render.state}|${project.version}|${project.deletedAt ?? ""}`;
  const urgent = lastWritten.get(project.id) !== marker;
  const timer = pending.get(project.id);
  if (urgent || !dbEnabled()) {
    if (timer) clearTimeout(timer);
    pending.delete(project.id);
    lastWritten.set(project.id, marker);
    return write(project);
  }
  if (!timer) {
    pending.set(
      project.id,
      setTimeout(() => {
        pending.delete(project.id);
        const latest = cache.get(project.id);
        if (latest) void write(latest).catch((error) => console.error("[store] deferred save failed:", error));
      }, DEBOUNCE_MS)
    );
  }
  return Promise.resolve();
};

/** Write every deferred project now (shutdown). */
export const flushProjects = async (): Promise<void> => {
  const ids = [...pending.keys()];
  for (const id of ids) {
    clearTimeout(pending.get(id));
    pending.delete(id);
    const p = cache.get(id);
    if (p) await write(p).catch((error) => console.error("[store] final save failed:", error));
  }
  await Promise.all([...writes.values()].map((w) => w.catch(() => undefined)));
};

export const createProject = async (
  url: string,
  options: ProjectOptions,
  userId = "local"
): Promise<Project> => {
  const id = newId();
  const now = Date.now();
  const project: Project = {
    id,
    userId,
    url,
    title: new URL(url).hostname.replace(/^www\./, ""),
    createdAt: now,
    updatedAt: now,
    stage: "created",
    activity: "Queued",
    options,
    scenes: [],
    version: 0,
    render: { state: "idle", progress: 0 },
    audio: structuredClone(DEFAULT_AUDIO),
    cuePlan: [],
    chat: options.prompt
      ? [{ id: newId(), role: "user", text: options.prompt, at: now, kind: "prompt" }]
      : [],
    log: [],
  };
  cache.set(id, project);
  await persist(project);
  bus.emit(id, project);
  return project;
};

/** Stages a restart abandons mid-way (the job that was running them is gone). */
const INTERRUPTED: string[] = ["ingesting", "profile", "directing", "coding", "verifying"];

export const getProject = async (id: string): Promise<Project> => {
  assertId(id);
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const project = dbEnabled() ? await readRow(id) : (JSON.parse(await fs.readFile(jsonFile(id), "utf8")) as Project);
    // A restart abandons any in-flight pipeline: surface that instead of
    // leaving the UI spinning forever.
    if (INTERRUPTED.includes(project.stage)) {
      project.stage = "error";
      project.error = "The server restarted while this was running. Retry the step.";
    }
    if (project.render.state === "running") {
      project.render = { state: "error", progress: 0, error: "Render interrupted by a restart." };
    }
    project.chat = project.chat ?? [];
    project.audio = project.audio ?? structuredClone(DEFAULT_AUDIO);
    project.cuePlan = project.cuePlan ?? [];
    project.options.prompt = project.options.prompt ?? "";
    project.userId = project.userId ?? "local";
    // a concurrent load may have won the race; keep one instance per project
    const raced = cache.get(id);
    if (raced) return raced;
    cache.set(id, project);
    return project;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, `Project "${id}" does not exist.`);
    }
    throw error;
  }
};

const readRow = async (id: string): Promise<Project> => {
  const row = must(await db().from("projects").select("data, user_id").eq("id", id).maybeSingle(), `load project ${id}`) as {
    data: Project;
    user_id: string;
  } | null;
  if (!row) throw Object.assign(new Error("not found"), { code: "ENOENT" });
  return { ...row.data, userId: row.user_id };
};

/** What a project list shows: a handful of fields, never the whole document. */
export type ProjectSummary = {
  id: string;
  url: string;
  title: string;
  stage: Project["stage"];
  activity: string;
  updatedAt: number;
  createdAt: number;
  version: number;
  hasThumbnail: boolean;
  render: Project["render"];
  logo: string | null;
  /** "16:9" or "9:16" (older projects: landscape). */
  aspect: Aspect;
  /** A free preview not paid for yet: its owner can't delete it. */
  unpaidPreview: boolean;
};

export const summarize = (p: Project): ProjectSummary => ({
  id: p.id,
  url: p.url,
  title: p.title,
  stage: p.stage,
  activity: p.activity,
  updatedAt: p.updatedAt,
  createdAt: p.createdAt,
  version: p.version,
  hasThumbnail: p.stage === "ready",
  render: p.render,
  logo: p.profile?.assets.find((a) => a.kind === "logo")?.name ?? null,
  aspect: p.options.aspect ?? "16:9",
  unpaidPreview: !!p.options.freePreview && !p.charge,
});

/** Only the JSON paths a summary needs: a list never loads chat, logs or storyboards. */
const SUMMARY_COLUMNS =
  "id, url, title, stage, activity:data->>activity, updatedAt:data->updatedAt, createdAt:data->createdAt, version:data->version, render:data->render, assets:data->profile->assets, aspect:data->options->>aspect, freePreview:data->options->freePreview, charge:data->charge";

type SummaryRow = Omit<ProjectSummary, "hasThumbnail" | "logo" | "aspect" | "unpaidPreview"> & {
  aspect: Aspect | null;
  assets: Array<{ kind?: string; name?: string }> | null;
  freePreview: boolean | null;
  charge: Project["charge"] | null;
};

/**
 * One page of a user's projects, newest first, without the ones they deleted. A project this
 * server holds in memory is summarized from there (it can be newer than its row); any other
 * gets the same restart handling as getProject.
 */
export const listSummariesOf = async (
  userId: string,
  offset = 0,
  limit = 12
): Promise<{ projects: ProjectSummary[]; hasMore: boolean }> => {
  if (!dbEnabled()) {
    const all = (await listProjects()).filter((p) => (p.userId ?? "local") === userId && !p.deletedAt);
    return { projects: all.slice(offset, offset + limit).map(summarize), hasMore: all.length > offset + limit };
  }
  const rows = must(
    await db()
      .from("projects")
      .select(SUMMARY_COLUMNS)
      .eq("user_id", userId)
      .is("data->deletedAt", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit), // one extra row: is there a next page?
    "list projects"
  ) as unknown as SummaryRow[];
  // a project deleted on this server a moment ago can still be in its row's page until the write lands
  const projects = rows.slice(0, limit).filter((r) => !cache.get(r.id)?.deletedAt).map((r): ProjectSummary => {
    const cached = cache.get(r.id);
    if (cached) return summarize(cached);
    const interrupted = INTERRUPTED.includes(r.stage);
    const stage = interrupted ? "error" : r.stage;
    return {
      id: r.id,
      url: r.url,
      title: r.title,
      stage,
      activity: r.activity ?? "",
      updatedAt: Number(r.updatedAt),
      createdAt: Number(r.createdAt),
      version: Number(r.version ?? 0),
      hasThumbnail: stage === "ready",
      render: r.render?.state === "running" ? { state: "error", progress: 0, error: "Render interrupted by a restart." } : r.render ?? { state: "idle", progress: 0 },
      logo: r.assets?.find((a) => a.kind === "logo")?.name ?? null,
      aspect: r.aspect === "9:16" ? "9:16" : "16:9",
      unpaidPreview: !!r.freePreview && !r.charge,
    };
  });
  return { projects, hasMore: rows.length > limit };
};

/** Every project (newest first), or the latest `limit` when the database is on. */
export const listProjects = async (limit = 50): Promise<Project[]> => {
  if (dbEnabled()) {
    const rows = must(
      await db().from("projects").select("id").order("updated_at", { ascending: false }).limit(limit),
      "list projects"
    ) as Array<{ id: string }>;
    const projects: Project[] = [];
    for (const { id } of rows) {
      try {
        projects.push(await getProject(id));
      } catch {
        // deleted meanwhile
      }
    }
    return projects;
  }
  const root = path.resolve(config.dataDir, "projects");
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!PROJECT_ID.test(entry)) continue;
    try {
      projects.push(await getProject(entry));
    } catch {
      // Skip unreadable projects.
    }
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
};

/** Mutate a project, persist it and notify SSE listeners. */
export const updateProject = async (
  id: string,
  mutate: (project: Project) => void
): Promise<Project> => {
  const project = await getProject(id);
  mutate(project);
  project.updatedAt = Date.now();
  if (project.log.length > 300) project.log.splice(0, project.log.length - 300);
  if (project.reasoning && project.reasoning.length > 30_000) {
    project.reasoning = project.reasoning.slice(-30_000);
  }
  await persist(project);
  bus.emit(id, project);
  return project;
};

export const say = (
  id: string,
  text: string,
  role: "user" | "assistant" = "assistant",
  kind: "prompt" | "status" | "reply" = "status",
  /** Images attached to the message (asset file names). */
  images: string[] = []
): Promise<Project> =>
  updateProject(id, (p) => {
    p.chat = p.chat ?? [];
    p.chat.push({ id: newId(), role, text, at: Date.now(), kind, ...(images.length ? { images } : {}) });
  });

export const deleteProject = async (id: string): Promise<void> => {
  assertId(id);
  const timer = pending.get(id);
  if (timer) clearTimeout(timer);
  pending.delete(id);
  await writes.get(id)?.catch(() => undefined);
  cache.delete(id);
  lastWritten.delete(id);
  if (dbEnabled()) must(await db().from("projects").delete().eq("id", id), `delete project ${id}`);
  await fs.rm(projectDir(id), { recursive: true, force: true });
  bus.emit(id, null);
};

export const subscribe = (
  id: string,
  listener: (project: Project | null) => void
): (() => void) => {
  bus.on(id, listener);
  return () => bus.off(id, listener);
};

export const log = (
  id: string,
  message: string,
  level: "info" | "warn" | "error" = "info"
): Promise<Project> =>
  updateProject(id, (p) => {
    p.log.push({ at: Date.now(), level, message });
  });

export const setActivity = (
  id: string,
  activity: string,
  stage?: Project["stage"]
): Promise<Project> => {
  // each new step is where a stopped job ends, even one whose last call was caught
  if (stopRequested()) return Promise.reject(new Stopped());
  return updateProject(id, (p) => {
    const now = Date.now();
    p.activity = activity;
    if (stage) p.stage = stage;
    p.log.push({ at: now, level: "info", message: activity });
    // one timed step per activity: the previous one ends where this one starts
    const steps = (p.steps ??= []);
    const open = steps[steps.length - 1];
    if (open && open.end === undefined) open.end = now;
    steps.push({ label: activity, at: now });
    if (steps.length > 40) steps.splice(0, steps.length - 40);
  });
};
