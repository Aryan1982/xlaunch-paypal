"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Project } from "./types";

/**
 * Live project state. Uses Server-Sent Events and falls back to polling if the
 * stream drops (e.g. proxy hiccup), so the UI never freezes on stale data.
 */
export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProject(await api.getProject(id));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    let closed = false;
    const source = new EventSource(`/api/projects/${id}/events`);

    const startPolling = () => {
      if (pollRef.current || closed) return;
      pollRef.current = setInterval(refresh, 2500);
    };
    const stopPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };

    source.onmessage = (event) => {
      stopPolling();
      const data = JSON.parse(event.data) as Project | null;
      if (data === null) setMissing(true);
      else {
        setProject(data);
        setError(null);
      }
    };
    source.onerror = () => {
      // EventSource retries by itself; poll meanwhile.
      void refresh();
      startPolling();
    };

    void refresh();
    return () => {
      closed = true;
      source.close();
      stopPolling();
    };
  }, [id, refresh]);

  return { project, error, missing, refresh };
}
