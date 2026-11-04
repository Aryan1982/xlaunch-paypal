import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ExampleFilm } from "@/components/ExampleFilm";
import { ExamplesClient } from "@/components/home/ExamplesClient";
import { describeFilms, videoObject, type Film } from "@/lib/films";
import { getShowcase } from "@/lib/showcase-server";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const TITLE = "Example launch videos";
const DESCRIPTION = "Launch videos made with XLaunch from a website: 2D motion graphics and 3D films, each with its story, voice-over and scenes made by AI. Press play to watch one.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/examples" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/examples", type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

/** The page and its films as videos search engines can list (schema.org VideoObject). */
const jsonLd = (films: Film[]) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}/examples#page`,
      url: `${SITE_URL}/examples`,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#app` },
      inLanguage: "en",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: TITLE, item: `${SITE_URL}/examples` },
      ],
    },
    {
      "@type": "ItemList",
      name: `Example launch videos made with ${SITE_NAME}`,
      url: `${SITE_URL}/examples`,
      itemListElement: films.map((film, i) => ({ "@type": "ListItem", position: i + 1, item: videoObject(film) })),
    },
  ],
});

const length = (film: Film) => `${Math.round(film.item.seconds)} s · ${film.item.height > film.item.width ? "vertical" : film.item.height === film.item.width ? "square" : "landscape"}`;

const h2 = "text-[22px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[26px]";
const body = "mt-3 text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]";

/** What the films are and how they were made: the same text before and after the page's script runs. */
function ExamplesAbout({ films }: { films: Film[] }) {
  const byMode = (mode: "2d" | "3d") => films.filter((f) => f.item.mode === mode);
  const list = (mode: "2d" | "3d") =>
    byMode(mode).length > 0 && (
      <ul className="mt-4 space-y-1.5 text-sm text-[color:var(--hero-fg-mute)]">
        {byMode(mode).map((f) => (
          <li key={f.item.id}>
            {f.name} ({length(f)})
          </li>
        ))}
      </ul>
    );
  return (
    <section aria-label="About these videos" className="mx-auto mt-16 max-w-[760px]">
      <h2 className={h2}>2D launch videos</h2>
      <p className={body}>
        2D videos are motion graphics built around the product itself: its interface, its words and its logo, animated in step with the narration. They suit SaaS products,
        developer tools and apps, where people want to see the screens. Most run 20 to 60 seconds, in landscape (16:9) for a launch post or a landing page, or vertical
        (9:16) for Reels, Shorts and TikTok.
      </p>
      {list("2d")}

      <h2 className={`${h2} mt-12`}>3D launch films</h2>
      <p className={body}>
        3D films are short films where every shot is built in 3D: a camera moves through a world made for the product, with light and motion that carry the story. They suit a
        bigger moment, such as a first launch or a funding announcement, where a film stands out more than a product tour. 3D is in beta.
      </p>
      {list("3d")}

      <h2 className={`${h2} mt-12`}>How these were made</h2>
      <p className={body}>
        Each video started from a prompt with a website in it, such as &ldquo;Make a launch video for https://yourproduct.com, for operations teams, confident and
        calm&rdquo;. {SITE_NAME} read the site, wrote a short story and a voice-over, and built every scene in code in the product&rsquo;s colours and fonts. None of it is
        stock footage or a screen recording. A new video usually takes 10 to 20 minutes; a change asked for in chat (&ldquo;show the dashboard first&rdquo;, &ldquo;shorter
        intro&rdquo;) takes a few minutes. The finished film exports as an MP4 you own and can post anywhere.
      </p>
      <p className={body}>
        Want to see yours? Free preview · no card needed: {SITE_NAME} plans your whole film and builds the opening so you can watch it before you buy.{" "}
        <Link href="/" className="text-[color:var(--hero-fg)] underline underline-offset-4">
          Make yours from your website
        </Link>
        . Or see the videos for{" "}
        <Link href="/for" className="text-[color:var(--hero-fg)] underline underline-offset-4">
          SaaS, Product Hunt, apps, developer tools and startups
        </Link>
        .
      </p>
    </section>
  );
}

/** What the server sends before the page's script runs: the heading, every example as a playable film, and the text. */
function ExamplesStatic({ films, children }: { films: Film[]; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-24 pt-16">
      <h1 className="text-[32px] font-medium tracking-tight sm:text-[40px]">{TITLE}</h1>
      <p className="mt-2 text-[15px] opacity-70">{DESCRIPTION}</p>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {films.map((film) => (
          <li key={film.item.id}>
            <ExampleFilm film={film} caption={`${film.item.title} · ${film.item.mode === "3d" ? "3D" : "2D"} · ${length(film)}`} />
          </li>
        ))}
      </ul>
      {children}
    </main>
  );
}

export default async function ExamplesPage() {
  const films = describeFilms(await getShowcase());
  const about = <ExamplesAbout films={films} />;
  return (
    <>
      {films.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(films)).replace(/</g, "\\u003c") }} />
      )}
      <Suspense fallback={<ExamplesStatic films={films}>{about}</ExamplesStatic>}>
        <ExamplesClient>{about}</ExamplesClient>
      </Suspense>
    </>
  );
}
