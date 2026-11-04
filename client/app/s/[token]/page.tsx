import type { Metadata } from "next";
import { cache } from "react";

import type { PublicShare } from "@/lib/api";
import { API_ORIGIN } from "@/lib/api-origin";
import { SITE_NAME } from "@/lib/site";
import { SharedFilm } from "./SharedFilm";

/** The film a share link opens (no session: the API checks the token); null when the link doesn't work. */
const getShare = cache(async (token: string): Promise<PublicShare | null> => {
  try {
    const res = await fetch(`${API_ORIGIN}/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PublicShare) : null;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const share = await getShare((await params).token);
  const title = share ? `Launch video for ${share.title}` : "Shared video";
  const description = share?.preview
    ? `A free preview of ${share.title}'s launch video, made with XLaunch from its website.`
    : share
      ? `${share.title}'s launch video, made with XLaunch from its website.`
      : "A launch video made with XLaunch from a website.";
  return {
    title,
    description,
    // a private link: never in search results
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", siteName: SITE_NAME },
    twitter: { title, description },
  };
}

/** A film opened by its share link (/s/<token>): anyone with the link watches it, signed in or not. */
export default async function SharePage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  return <SharedFilm token={token} share={await getShare(token)} />;
}
