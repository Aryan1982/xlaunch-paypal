import type { MetadataRoute } from "next";

import { ALTERNATIVES } from "@/lib/alternatives";
import { describeFilms, filmPosterUrl, filmVideoUrl } from "@/lib/films";
import { getShowcase } from "@/lib/showcase-server";
import { SITE_URL } from "@/lib/site";
import { USE_CASES } from "@/lib/use-cases";

export const revalidate = 600;

/** Next writes sitemap fields into the XML as they are: text has to be escaped here. */
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Every public page; /examples carries the example films (Google's video sitemap extension), so they can be found as videos. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const films = describeFilms(await getShowcase());
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE_URL}/examples`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
      videos: films.map(({ item, name, description }) => ({
        title: xml(name),
        description: xml(description),
        thumbnail_loc: xml(filmPosterUrl(item)),
        content_loc: xml(filmVideoUrl(item)),
        duration: Math.max(1, Math.round(item.seconds)),
        publication_date: item.uploadedAt,
        family_friendly: "yes" as const,
      })),
    },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/for`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...USE_CASES.map((u) => ({ url: `${SITE_URL}/for/${u.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${SITE_URL}/alternatives`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...ALTERNATIVES.map((a) => ({ url: `${SITE_URL}/alternatives/${a.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/refunds`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
