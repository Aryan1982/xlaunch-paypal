import { randomBytes } from "node:crypto";

import type { FeedFrame, FeedItem, FeedStatus, Project } from "../types";

/**
 * A film's activity feed: what its agent did, entry by entry, for the chat's
 * timeline (Project.feed). Append-only; the newest FEED_CAP entries are kept.
 * These change a project in place, inside an updateProject (motion-agent.ts).
 */

export const FEED_CAP = 500;

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An entry before it is placed: the feed gives it its id, time and run. */
export type NewFeedItem = Without<FeedItem, "id" | "at" | "run">;
/** An entry that runs (a step, a stills round, a check, a narration line): it has a status. */
export type FeedTask = Extract<FeedItem, { status: FeedStatus }>;

const isTask = (item: FeedItem): item is FeedTask => "status" in item;

/**
 * Adds an entry to the project's feed; returns the entry it landed on. A step
 * with the label of the feed's newest entry (in the same run, not failed) is
 * the same work going on (another edit of the same scene, another frame looked
 * at): it is counted on that entry instead of adding one.
 */
export function pushFeed(p: Project, run: number, item: NewFeedItem, now = Date.now()): FeedItem {
  const feed = (p.feed ??= []);
  const last = feed.at(-1);
  if (item.kind === "step" && last?.kind === "step" && last.run === run && last.label === item.label && last.status !== "error") {
    last.count = (last.count ?? 1) + (item.count ?? 1);
    last.open = (last.open ?? 0) + (item.open ?? 0);
    if (item.detail) last.detail = item.detail;
    if (last.open > 0) {
      last.status = "running";
      delete last.end;
    }
    return last;
  }
  const entry = { ...item, id: randomBytes(6).toString("base64url"), at: now, run } as FeedItem;
  feed.push(entry);
  if (feed.length > FEED_CAP) feed.splice(0, feed.length - FEED_CAP);
  return entry;
}

const findTask = (p: Project, itemId: string): FeedTask | undefined => {
  const feed = p.feed ?? [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const item = feed[i]!;
    if (item.id === itemId) return isTask(item) ? item : undefined;
  }
  return undefined;
};

const STILL = /^frame (\d+) \((\d+(?:\.\d+)?)s\) -> review\/(r\d+)\/(f\d+\.jpg)\s*$/gm;

/** The frames a stills command reports it rendered ("frame 120 (4.00s) -> review/r03/f0120.jpg"), in order. */
export const parseStills = (output: string): FeedFrame[] =>
  [...output.matchAll(STILL)].map((m) => ({ frame: Number(m[1]), seconds: Number(m[2]), round: m[3]!, file: m[4]! }));

/** A tool's output as one short line: its first line with text, without Claude Code's error tags. */
export const firstLine = (output: string, max = 240): string => {
  const line = output
    .replace(/<\/?tool_use_error>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return (line ?? "").slice(0, max);
};

/**
 * One of an entry's tool calls came back. A check fails on a TypeScript error
 * in its output (the check tool reports them without failing); a stills round
 * takes the frames it rendered. Once its last open call is back the entry is
 * done, or failed if any of them failed. Returns the entry (none: not a task of this feed).
 */
export function settleFeed(p: Project, itemId: string, result: { error: boolean; output: string }, now = Date.now()): FeedTask | undefined {
  const item = findTask(p, itemId);
  if (!item) return undefined;
  const typeErrors = item.kind === "check" ? result.output.match(/\berror TS\d+/g)?.length ?? 0 : 0;
  if (item.kind === "stills" && !result.error) item.frames = parseStills(result.output);
  if (result.error || typeErrors > 0) {
    item.status = "error";
    const firstError = result.output.split("\n").find((l) => /\berror TS\d+/.test(l)) ?? "";
    item.detail = typeErrors > 0 ? `${typeErrors} type error${typeErrors === 1 ? "" : "s"}: ${firstLine(firstError)}` : firstLine(result.output);
  }
  item.open = Math.max(0, (item.open ?? 1) - 1);
  if (item.open === 0) {
    delete item.open;
    item.end = now;
    if (item.status === "running") item.status = "done";
  }
  return item;
}

/** Ends a run's entries still running: "done" when it finished, "stopped" when it failed or was stopped first. */
export function closeFeed(p: Project, run: number, status: "done" | "stopped", now = Date.now()): void {
  for (const item of p.feed ?? []) {
    if (item.run !== run || !isTask(item) || item.status !== "running") continue;
    item.status = status;
    item.end = now;
    delete item.open;
  }
}

/** The longest thought kept (the agent's text between its tool calls). */
export const THOUGHT_MAX = 2000;

/** Drops the run's newest thought when it is `text`: the agent's closing summary, which the chat shows as its reply. */
export function dropSummary(p: Project, run: number, text: string): void {
  const last = p.feed?.at(-1);
  if (last?.kind === "thought" && last.run === run && last.text === text.trim().slice(0, THOUGHT_MAX)) p.feed!.pop();
}
