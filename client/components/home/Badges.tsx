import { BADGES, badgeImages, type Badge } from "@/lib/badges";
import { SITE_NAME } from "@/lib/site";

/**
 * One directory badge: its link and its own image (the dark variant in the
 * dark theme). `size` sets the image box; the image keeps its aspect ratio.
 */
function BadgeLink({ badge, size, lazy, className }: { badge: Badge; size: string; lazy?: boolean; className?: string }) {
  const images = badgeImages(badge);
  return (
    <a href={badge.href} target="_blank" rel="noopener" title={`${SITE_NAME} on ${badge.name}`} className={className}>
      {images.map(({ src }, i) => (
        <img
          key={src}
          src={src}
          alt={`${SITE_NAME} on ${badge.name}`}
          width={badge.width}
          height={badge.height}
          loading={lazy ? "lazy" : undefined}
          className={`${size} object-contain ${images.length === 1 ? "" : i === 0 ? "dark:hidden" : "hidden dark:block"}`}
        />
      ))}
    </a>
  );
}

/** Above the headline: the badges marked `hero` (Product Hunt), in full colour. */
export function HeroBadges({ className }: { className?: string }) {
  const hero = BADGES.filter((b) => b.hero);
  if (!hero.length) return null;
  return (
    <ul aria-label="Featured on" className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      {hero.map((b) => (
        <li key={b.slug}>
          <BadgeLink badge={b} size="h-10 w-auto" className="block transition-opacity hover:opacity-85" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The footer: every directory XLaunch is listed on, in BADGES order, on an
 * even grid. Each badge sits in the same box and is shown muted (grey, softer)
 * so a dozen differently styled badges read as one quiet row; full colour on hover.
 */
export function FeaturedOn() {
  return (
    <section aria-labelledby="featured-on" className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:gap-6">
      <h2 id="featured-on" className="shrink-0 sm:pt-2.5">
        Featured on:
      </h2>
      <ul className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
        {BADGES.map((b) => (
          <li key={b.slug} className="flex h-10 items-center">
            <BadgeLink
              badge={b}
              size="h-auto max-h-8 w-auto max-w-full"
              lazy
              className="flex h-full max-w-full items-center opacity-60 grayscale transition duration-200 hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
