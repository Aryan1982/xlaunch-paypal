"use client";

import { useEffect, useState } from "react";
import { Download, RotateCw, Square } from "lucide-react";

import { api, downloadUrl } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Button, Spinner } from "@/components/ui";

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** Seconds ticking while a render runs, so elapsed time and the ETA move. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Header action: render → progress with ETA → download. */
export function ExportButton({ project }: { project: Project }) {
  const [error, setError] = useState<string | null>(null);
  const r = project.render;
  const running = r.state === "running";
  const now = useNow(running);
  const [stopping, setStopping] = useState<number | null>(null);

  const stop = async () => {
    setStopping(r.startedAt ?? 0);
    setError(null);
    try {
      await api.stop(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStopping(null);
    }
  };
  const isStopping = running && stopping !== null && stopping === (r.startedAt ?? 0);

  const start = async () => {
    setError(null);
    try {
      await api.render(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const failure = error ?? (r.state === "error" ? r.error ?? "Render failed." : null);
  const elapsed = r.startedAt ? now - r.startedAt : 0;
  // the first few percent include opening the browser and bundling: no ETA yet
  const eta = r.progress > 0.04 && elapsed > 3000 ? (elapsed * (1 - r.progress)) / r.progress : null;
  const took = r.state === "done" && r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null;

  return (
    <div className="flex items-center gap-2">
      {failure && (
        <span className="hidden max-w-[220px] truncate text-xs text-bad sm:inline" title={failure} role="alert">
          Export failed
        </span>
      )}
      {!failure && !running && r.stopped && <span className="hidden text-xs text-dim sm:inline">Export stopped</span>}
      {running ? (
        <div className="flex h-8 items-center gap-2.5 rounded-lg bg-panel-hi px-3 text-[13px] text-mute" role="status">
          <Spinner className="size-3.5 text-accent" />
          Rendering {Math.round(r.progress * 100)}%
          <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(4, r.progress * 100)}%` }} />
          </span>
          <span className="tabular-nums">
            {clock(elapsed)}
            {eta !== null ? ` · ~${clock(eta)} left` : ""}
          </span>
          <button
            onClick={() => void stop()}
            disabled={isStopping}
            aria-label={isStopping ? "Stopping the export" : "Stop the export"}
            title={isStopping ? "Stopping…" : "Stop the export"}
            className="-mr-1.5 ml-0.5 grid size-6 cursor-pointer place-items-center rounded-md text-mute transition-colors hover:bg-line hover:text-fg disabled:cursor-wait disabled:opacity-50"
          >
            <Square className="size-3 fill-current" />
          </button>
        </div>
      ) : r.state === "done" ? (
        <>
          {took !== null && <span className="hidden text-xs text-mute tabular-nums sm:inline">Exported in {clock(took)}</span>}
          {/* again: export the film once more */}
          <Button size="sm" variant="ghost" onClick={start} aria-label="Render again" title="Render again">
            <RotateCw className="size-3.5" />
          </Button>
          <a href={downloadUrl(project.id)}>
            <Button size="sm" variant="primary">
              <Download className="size-3.5" /> Download MP4
            </Button>
          </a>
        </>
      ) : (
        <Button size="sm" variant="primary" onClick={start}>
          <Download className="size-3.5" /> Export
        </Button>
      )}
    </div>
  );
}
