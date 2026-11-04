"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";

import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";
import { Button, ErrorBanner, Skeleton } from "@/components/ui";
import { ProjectCard } from "@/components/ProjectCard";

/** Projects per page: the next page loads as the list is scrolled to its end. */
const PAGE = 12;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const Placeholders = ({ count }: { count: number }) => (
  <>
    {Array.from({ length: count }, (_, i) => (
      <div key={i}>
        <Skeleton className="aspect-video rounded-xl" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>
    ))}
  </>
);

/** Modal with every saved project. Native <dialog> gives focus trapping and Esc for free. */
export function SavedProjects({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string; page: "first" | "next" } | null>(null);
  /** One page request at a time (the observer can fire again before state settles). */
  const busy = useRef(false);

  /** The first page. A list shown before stays on screen until it arrives. */
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const page = await api.listProjects(0, PAGE);
      setProjects(page.projects);
      setHasMore(page.hasMore);
    } catch (e) {
      setError({ message: messageOf(e), page: "first" });
      setProjects((p) => p ?? []);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (busy.current || !projects || !hasMore) return;
    busy.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      // deletions also leave the server's list, so the count loaded is the next offset
      const page = await api.listProjects(projects.length, PAGE);
      setProjects((prev) => {
        const seen = new Set(prev?.map((p) => p.id));
        return [...(prev ?? []), ...page.projects.filter((p) => !seen.has(p.id))];
      });
      setHasMore(page.hasMore);
    } catch (e) {
      setError({ message: messageOf(e), page: "next" });
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [projects, hasMore]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void refresh();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, refresh]);

  // Next page when the end of the list scrolls into view (a little early, so it is usually there in time).
  useEffect(() => {
    const target = sentinel.current;
    if (!open || !target || !hasMore || error) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), {
      root: scroller.current,
      rootMargin: "400px 0px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, hasMore, error, loadMore]);

  const removed = (id: string) => setProjects((prev) => prev?.filter((p) => p.id !== id) ?? null);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(960px,92vw)] rounded-3xl border border-line bg-panel p-0 text-fg shadow-[0_40px_120px_-30px_rgba(0,0,0,0.55)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-2.5 font-medium">
          <FolderOpen className="size-4 text-mute" /> Saved projects
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 place-items-center rounded-lg text-mute transition-colors hover:bg-panel-hi hover:text-fg cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>
      <div ref={scroller} className="scroll-thin max-h-[70vh] overflow-auto p-6">
        {projects === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
            <Placeholders count={6} />
          </div>
        ) : projects.length === 0 && !error ? (
          <p className="py-14 text-center text-sm text-dim">No saved projects yet. Describe your first video on the main screen.</p>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDeleted={() => removed(p.id)} />
              ))}
              {loadingMore && <Placeholders count={3} />}
            </div>
            {error && (
              <div className="mt-5">
                <ErrorBanner
                  message={`Couldn't load your projects: ${error.message}`}
                  action={
                    <Button size="sm" variant="secondary" onClick={() => void (error.page === "next" ? loadMore() : refresh())}>
                      Retry
                    </Button>
                  }
                />
              </div>
            )}
            {hasMore && !loadingMore && !error && (
              <div className="mt-6 flex justify-center">
                <Button size="sm" variant="ghost" onClick={() => void loadMore()}>
                  Load more
                </Button>
              </div>
            )}
            <div ref={sentinel} aria-hidden className="h-px" />
          </>
        )}
      </div>
    </dialog>
  );
}
