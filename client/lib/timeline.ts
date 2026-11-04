import type { ChatMessage, FeedItem } from "./types";

export type Thought = Extract<FeedItem, { kind: "thought" }>;
/** A feed entry shown as a row of the timeline (thoughts are grouped, a run's first entry is its header). */
export type FeedRow = Exclude<FeedItem, { kind: "thought" | "run" }>;
export type RunHeader = Extract<FeedItem, { kind: "run" }>;

/** The chat as it reads: its messages and, at the time each started, the agent runs with their entries. */
export type TimelineEntry = { type: "message"; at: number; message: ChatMessage } | { type: "run"; at: number; run: number; header?: RunHeader; items: FeedItem[] };

/** One block of a run: consecutive thoughts as one "Thinking details", or one row. */
export type Segment = { type: "thinking"; key: string; thoughts: Thought[] } | { type: "row"; key: string; item: FeedRow };

/**
 * The chat's messages and the feed's runs in time order, each run at its
 * first entry (a run whose first entries were dropped by the feed's cap starts
 * at its oldest one left). A message and a run at the same moment: the message
 * first, as it asked for the run.
 */
export function timelineOf(chat: ChatMessage[], feed: FeedItem[]): TimelineEntry[] {
  const runs = new Map<number, FeedItem[]>();
  for (const item of feed) {
    const items = runs.get(item.run);
    if (items) items.push(item);
    else runs.set(item.run, [item]);
  }
  const entries: TimelineEntry[] = chat.map((message) => ({ type: "message", at: message.at, message }));
  for (const [run, items] of runs) {
    const header = items[0]?.kind === "run" ? items[0] : undefined;
    entries.push({ type: "run", at: items[0]!.at, run, header, items: header ? items.slice(1) : items });
  }
  return entries.sort((a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "message" ? -1 : 1));
}

/** A run's entries as blocks: thoughts in a row become one block. */
export function segmentsOf(items: FeedItem[]): Segment[] {
  const out: Segment[] = [];
  for (const item of items) {
    if (item.kind === "run") continue;
    if (item.kind === "thought") {
      const last = out.at(-1);
      if (last?.type === "thinking") last.thoughts.push(item);
      else out.push({ type: "thinking", key: item.id, thoughts: [item] });
      continue;
    }
    out.push({ type: "row", key: item.id, item });
  }
  return out;
}
