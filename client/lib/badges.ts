/**
 * "Featured on" badges shown in the site footer, in this order: Product Hunt
 * (also above the home headline), then listings that are live or queued, then
 * the ones whose free listing waits on the badge being found on xlaunch.pro.
 * Each one links to the directory and shows the directory's own image (several
 * free listings require the badge to stay on the site, unchanged, to keep the
 * listing and its link). `dark` is the dark-theme variant when one is offered.
 *
 * The pages are cross-origin isolated (COEP require-corp, next.config.ts) and
 * the directories' image hosts send no CORP header, so remote images are
 * served from our own origin: /badge/<slug>.svg and /badge/<slug>-dark.svg
 * (app/badge/[file]/route.ts), fetched from `light` / `dark`. A host that
 * blocks server fetches (a bot challenge) gets a saved copy in
 * public/badges/, given here as its path ("/badges/…") and used as is.
 */
export type Badge = {
  slug: string;
  name: string;
  href: string;
  light: string;
  dark?: string;
  /** the image's own size; it is shown 40px tall with this aspect ratio */
  width: number;
  height: number;
  /** also shown above the headline on the home page, not only in the footer */
  hero?: boolean;
};

export const BADGES: Badge[] = [
  {
    slug: "product-hunt",
    name: "Product Hunt",
    href: "https://www.producthunt.com/products/xlaunch?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-xlaunch",
    light: "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1294201&theme=light",
    dark: "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1294201&theme=dark",
    width: 250,
    height: 54,
    hero: true,
  },
  {
    slug: "devhunt",
    name: "DevHunt",
    href: "https://devhunt.org/tool/xlaunch",
    light: "https://devhunt.org/badge/xlaunch.svg?theme=light",
    dark: "https://devhunt.org/badge/xlaunch.svg",
    width: 220,
    height: 54,
  },
  // free launch 2026-11-30 (tinylaunch.com/launch/28134-xlaunch); swap to tinylaunch_badge_featured_on.svg after it
  {
    slug: "tinylaunch",
    name: "TinyLaunch",
    href: "https://www.tinylaunch.com/launch/28134-xlaunch",
    light: "https://tinylaunch.com/tinylaunch_badge_launching_soon.svg",
    width: 619,
    height: 188,
  },
  // free waiting line, launches 2027-04-17 (uneed.best/edit/waiting-line/65848)
  {
    slug: "uneed",
    name: "Uneed",
    href: "https://www.uneed.best/tool/xlaunch",
    light: "https://www.uneed.best/EMBED3.png",
    dark: "https://www.uneed.best/EMBED3B.png",
    width: 582,
    height: 152,
  },
  // free queue (#7933), live in ~4 months; optional badge, followed link
  {
    slug: "peerpush",
    name: "PeerPush",
    href: "https://peerpush.com/p/xlaunch",
    light: "https://peerpush.com/p/xlaunch/badge.png",
    width: 460,
    height: 130,
  },
  // required for the free launch (Aryan books the week after it's live: launchigniter.com/product/schedule/xlaunch)
  {
    slug: "launchigniter",
    name: "LaunchIgniter",
    href: "https://launchigniter.com/product/xlaunch?ref=badge-xlaunch",
    light: "https://launchigniter.com/api/badge/xlaunch?theme=light",
    dark: "https://launchigniter.com/api/badge/xlaunch?theme=dark",
    width: 212,
    height: 55,
  },
  // required on the home page for the free listing (verify after deploy: startupfa.me/dashboard/xlaunch/promote).
  // startupfa.me challenges server fetches: saved copies of startupfa.me/badge?t=small&theme=light|dark
  {
    slug: "startup-fame",
    name: "Startup Fame",
    href: "https://startupfa.me/s/xlaunch?utm_source=xlaunch.pro",
    light: "/badges/startup-fame-light.svg",
    dark: "/badges/startup-fame-dark.svg",
    width: 240,
    height: 36,
  },
  // required for the free listing (verify after deploy: twelve.tools/submit-your-tool?step=badge)
  {
    slug: "twelve-tools",
    name: "Twelve Tools",
    href: "https://twelve.tools",
    light: "https://twelve.tools/badge1-light.svg",
    dark: "https://twelve.tools/badge2-dark.svg",
    width: 200,
    height: 54,
  },
  // required, for as long as the listing should stay up (verify after deploy: toolfame.com/payment/Iia9s8BvOyJQx1vC29e5Ly)
  {
    slug: "toolfame",
    name: "ToolFame",
    href: "https://toolfame.com/item/xlaunch",
    light: "https://toolfame.com/badge-light.svg",
    dark: "https://toolfame.com/badge-dark.svg",
    width: 160,
    height: 54,
  },
  // required for the free listing (verify after deploy on its edit page, findly.tools/profile/tools)
  {
    slug: "findly",
    name: "Findly.tools",
    href: "https://findly.tools/xlaunch?utm_source=xlaunch",
    light: "https://findly.tools/badges/findly-tools-badge-light.svg",
    dark: "https://findly.tools/badges/findly-tools-badge-dark.svg",
    width: 139,
    height: 44,
  },
  // required for the free listing: a followed link to dang.ai, kept while listed
  {
    slug: "dang",
    name: "Dang.ai",
    href: "https://dang.ai",
    light: "https://assets.dang.ai/badges/dang-verified-light.png",
    dark: "https://assets.dang.ai/badges/dang-verified-dark.png",
    width: 260,
    height: 94,
  },
  // required for the free listing (submit at fazier.com/launch, then "Verify Badge")
  {
    slug: "fazier",
    name: "Fazier",
    href: "https://fazier.com",
    light: "https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=featured&theme=light",
    dark: "https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=featured&theme=dark",
    width: 182,
    height: 43,
  },
  // required, as a followed link, to skip the full free weeks (openhunts.com/projects/submit → "Add our badge to skip")
  {
    slug: "openhunts",
    name: "OpenHunts",
    href: "https://openhunts.com",
    light: "https://cdn.openhunts.com/badges/club.webp",
    width: 486,
    height: 105,
  },
];

/**
 * A badge's images, light first: `src` for the <img>, and `upstream` for the
 * remote ones that /badge/[file] fetches (none for a saved copy).
 */
export function badgeImages(b: Badge): { src: string; upstream?: string }[] {
  return [
    { name: b.slug, url: b.light },
    ...(b.dark ? [{ name: `${b.slug}-dark`, url: b.dark }] : []),
  ].map(({ name, url }) =>
    url.startsWith("/")
      ? { src: url }
      : { src: `/badge/${name}.${(/\.(png|webp|jpe?g)(\?|$)/i.exec(url)?.[1] ?? "svg").toLowerCase()}`, upstream: url }
  );
}
