import { BADGES, badgeImages } from "@/lib/badges";

/**
 * /badge/<slug>.svg (and -dark): a directory's badge image served from our own
 * origin, since the cross-origin-isolated pages can't load it from the
 * directory's host (lib/badges.ts). Refetched hourly, so live counts (Product
 * Hunt upvotes) stay current.
 */
export const revalidate = 3600;

const FILES: Record<string, string> = Object.fromEntries(
  BADGES.flatMap(badgeImages).flatMap(({ src, upstream }) => (upstream ? [[src.slice("/badge/".length), upstream]] : []))
);

export function generateStaticParams() {
  return Object.keys(FILES).map((file) => ({ file }));
}

export const dynamicParams = false;

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!Object.hasOwn(FILES, file)) return new Response("Not found", { status: 404 });
  const upstream = FILES[file];
  const res = await fetch(upstream, { next: { revalidate } });
  if (!res.ok) return new Response("Badge unavailable", { status: 502 });
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/svg+xml",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
