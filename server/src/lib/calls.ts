import { AsyncLocalStorage } from "async_hooks";

/**
 * Where model-call timings go: the pipeline runs each project's work inside
 * `withCallLog`, and every model call made underneath reports one line
 * (model, attempt, time, prompt and reply size, retry reason) to that
 * project's log, so the time breakdown of a generation is visible.
 */
export type CallSink = (message: string, level?: "info" | "warn") => void;

/**
 * Who a model call is made for. Usage events (usage/ledger.ts) are billed to
 * this project and user; set it around any work that calls the model.
 */
export type CallContext = {
  sink?: CallSink;
  projectId?: string;
  userId?: string;
  signal?: AbortSignal;
  /** The project's effort for Claude 5.x calls (ProjectOptions.effort): wins over each call's default. */
  effort?: string;
};

/** The user stopped the job this work belongs to. */
export class Stopped extends Error {
  constructor() {
    super("Stopped.");
    this.name = "Stopped";
  }
}

const store = new AsyncLocalStorage<CallContext>();

export const withCallLog = <T>(sink: CallSink, work: () => Promise<T>, context: Omit<CallContext, "sink"> = {}): Promise<T> =>
  store.run({ ...store.getStore(), ...context, sink }, work);

export const withCallContext = <T>(context: Omit<CallContext, "sink">, work: () => Promise<T>): Promise<T> =>
  store.run({ ...store.getStore(), ...context }, work);

export const callContext = (): CallContext => store.getStore() ?? {};

/** Has the user stopped the job this code runs for? */
export const stopRequested = (): boolean => !!store.getStore()?.signal?.aborted;

export const reportCall = (message: string, level: "info" | "warn" = "info"): void => {
  store.getStore()?.sink?.(message, level);
};

const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** One line per model call: "Model · script · minimax-m3 · 41.2s · in 18.4k chars · out 2.1k (+thinking 3.0k)". */
export const callLine = (c: { label: string; model: string; ms: number; inChars: number; outChars: number; thinkChars: number; attempt?: number; note?: string }): string =>
  `Model · ${c.label} · ${c.model} · ${(c.ms / 1000).toFixed(1)}s · in ${k(c.inChars)} chars · out ${k(c.outChars)}${c.thinkChars ? ` (+thinking ${k(c.thinkChars)})` : ""}${c.attempt && c.attempt > 1 ? ` · attempt ${c.attempt}` : ""}${c.note ? ` · ${c.note}` : ""}`;
