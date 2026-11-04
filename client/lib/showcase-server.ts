import { API_ORIGIN } from "./api-origin";
import type { ShowcaseItem } from "./api";

/** Every home-page example (both styles), read on the server; empty when the API can't be reached. */
export const getShowcase = async (): Promise<ShowcaseItem[]> => {
  try {
    const res = await fetch(`${API_ORIGIN}/api/showcase`, { next: { revalidate: 600 } });
    return res.ok ? ((await res.json()) as { items: ShowcaseItem[] }).items : [];
  } catch {
    return [];
  }
};
