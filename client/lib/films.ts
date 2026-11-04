/**
 * The example films as search engines see them: a readable name and description per film,
 * and its schema.org VideoObject. /examples, the use-case pages and the video sitemap all
 * read from here, so a film is described the same way everywhere.
 */

import { showcasePosterUrl, showcaseVideoUrl, type ShowcaseItem } from "./api";
import { SITE_NAME, SITE_URL } from "./site";

export type Film = { item: ShowcaseItem; name: string; description: string };

/** Names and descriptions for a list of films; films with the same title are numbered, so every name is distinct. */
export const describeFilms = (items: ShowcaseItem[]): Film[] => {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const shape = item.height > item.width ? "vertical " : item.height === item.width ? "square " : "";
    // "30-second 2D launch video", "58-second vertical 3D launch film"
    const kind = `${Math.max(1, Math.round(item.seconds))}-second ${shape}${item.mode === "3d" ? "3D launch film" : "2D launch video"}`;
    // the server names a film with no title "Untitled" (or "Low poly" for a 3D one): those get no title here
    const title = /^(untitled|low poly)$/i.test(item.title.trim()) ? null : item.title;
    const base = title ? `${title}: a ${kind} made with ${SITE_NAME}` : `A ${kind} made with ${SITE_NAME}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      item,
      name: n > 1 ? `${base} (${n})` : base,
      description: `A ${kind}${title ? ` for ${title}` : ""}, made with ${SITE_NAME}, which turns a product's website into a launch video and builds every scene in code.`,
    };
  });
};

export const filmVideoUrl = (item: ShowcaseItem) => `${SITE_URL}${showcaseVideoUrl(item)}`;
export const filmPosterUrl = (item: ShowcaseItem) => `${SITE_URL}${showcasePosterUrl(item)}`;

/** A film as schema.org VideoObject, for the page it plays on. */
export const videoObject = ({ item, name, description }: Film) => ({
  "@type": "VideoObject",
  "@id": `${filmVideoUrl(item)}#video`,
  name,
  description,
  thumbnailUrl: filmPosterUrl(item),
  contentUrl: filmVideoUrl(item),
  uploadDate: item.uploadedAt,
  duration: `PT${Math.max(1, Math.round(item.seconds))}S`,
  width: item.width,
  height: item.height,
  inLanguage: "en",
  publisher: { "@id": `${SITE_URL}/#organization` },
});
