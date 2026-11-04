import { showcasePosterUrl, showcaseVideoUrl } from "@/lib/api";
import type { Film } from "@/lib/films";

/**
 * An example film that plays in the page, rendered on the server so crawlers see the video
 * itself: muted with controls, and nothing loads but the poster until someone presses play.
 */
export function ExampleFilm({ film, caption, className }: { film: Film; caption: string; className?: string }) {
  const { item, name } = film;
  return (
    <figure className={className}>
      <video
        src={showcaseVideoUrl(item)}
        poster={showcasePosterUrl(item)}
        width={item.width}
        height={item.height}
        controls
        muted
        playsInline
        preload="none"
        aria-label={name}
        className="h-auto max-h-[80vh] w-full rounded-xl bg-black ring-1 ring-line"
      />
      <figcaption className="mt-2 text-sm text-[color:var(--hero-fg-mute)]">{caption}</figcaption>
    </figure>
  );
}
