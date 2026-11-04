import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Public: the home page, terms and privacy. Private: projects, account pages and the API. AI crawlers are welcome on the public pages. */
export default function robots(): MetadataRoute.Robots {
  const disallow = ["/p/", "/billing", "/auth/", "/frame", "/api/", "/login"];
  return {
    rules: [{ userAgent: "*", allow: ["/", "/api/showcase/"], disallow }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
