import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { ExampleFilm } from "@/components/ExampleFilm";
import { MakeVideoLink, PageShell } from "@/components/home/PageShell";
import { describeFilms, videoObject } from "@/lib/films";
import { getShowcase } from "@/lib/showcase-server";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { USE_CASES } from "@/lib/use-cases";

export const dynamicParams = false;
export const revalidate = 600;

export const generateStaticParams = () => USE_CASES.map((u) => ({ slug: u.slug }));

export async function generateMetadata({ params }: PageProps<"/for/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const useCase = USE_CASES.find((u) => u.slug === slug);
  if (!useCase) return {};
  return {
    title: useCase.title,
    description: useCase.description,
    alternates: { canonical: `/for/${useCase.slug}` },
    openGraph: { title: useCase.title, description: useCase.description, url: `/for/${useCase.slug}`, type: "website" },
    twitter: { title: useCase.title, description: useCase.description },
  };
}

const panel = "rounded-2xl bg-panel/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line";

export default async function UseCasePage({ params }: PageProps<"/for/[slug]">) {
  const { slug } = await params;
  const useCase = USE_CASES.find((u) => u.slug === slug);
  if (!useCase) notFound();
  const url = `${SITE_URL}/for/${useCase.slug}`;
  // landscape 2D examples, so the grid stays even
  const films = describeFilms((await getShowcase()).filter((i) => i.mode === "2d" && i.width > i.height).slice(0, 6));

  // what search engines and answer engines read: the page, where it sits, how to do it and its questions
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#page`,
        url,
        name: useCase.title,
        description: useCase.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
        inLanguage: "en",
        ...(films.length ? { video: films.map((f) => ({ "@id": videoObject(f)["@id"] })) } : {}),
      },
      ...films.map(videoObject),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Use cases", item: `${SITE_URL}/for` },
          { "@type": "ListItem", position: 3, name: useCase.name, item: url },
        ],
      },
      {
        "@type": "HowTo",
        name: `How to make ${useCase.one} with ${SITE_NAME}`,
        step: useCase.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.title, text: s.body })),
      },
      {
        "@type": "FAQPage",
        mainEntity: useCase.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <section className="mx-auto w-full max-w-[860px] px-5 pb-12 pt-16 text-center">
          <nav aria-label="Breadcrumb" className="text-xs text-[color:var(--hero-fg-mute)]">
            <Link href="/for" className="hover:text-[color:var(--hero-fg)]">
              Use cases
            </Link>{" "}
            / {useCase.name}
          </nav>
          <h1 className="mt-3 text-balance text-[32px] font-medium leading-[1.12] tracking-tight text-[color:var(--hero-fg)] sm:text-[44px]">{useCase.h1}</h1>
          <p className="mx-auto mt-5 max-w-[680px] text-pretty text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]">{useCase.answer}</p>
          <div className="mt-8">
            <MakeVideoLink />
          </div>
        </section>

        <section aria-labelledby="why" className="mx-auto w-full max-w-[1120px] px-5 py-12">
          <h2 id="why" className="mb-8 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]">
            Why {SITE_NAME} for {useCase.name}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {useCase.points.map((p) => (
              <li key={p.title} className={`${panel} p-6`}>
                <h3 className="text-[17px] font-medium text-fg">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {films.length > 0 && (
          <section aria-labelledby="examples" className="mx-auto w-full max-w-[1120px] px-5 py-12">
            <h2 id="examples" className="mb-8 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]">
              Launch videos made with {SITE_NAME}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {films.map((film) => (
                <li key={film.item.id}>
                  <ExampleFilm film={film} caption={`${film.item.title} · ${Math.round(film.item.seconds)} s`} />
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-sm text-[color:var(--hero-fg-mute)]">
              <Link href="/examples" className="underline-offset-4 hover:text-[color:var(--hero-fg)] hover:underline">
                See every example, 2D and 3D
              </Link>
            </p>
          </section>
        )}

        <section aria-labelledby="how" className="mx-auto w-full max-w-[1120px] px-5 py-12">
          <h2 id="how" className="mb-8 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]">
            How to make one
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {useCase.steps.map((s, i) => (
              <li key={s.title} className={`${panel} p-6`}>
                <span className="grid size-8 place-items-center rounded-full bg-accent/15 text-sm font-medium text-accent tabular-nums">{i + 1}</span>
                <h3 className="mt-4 text-[17px] font-medium text-fg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className={`${panel} mx-auto mt-6 max-w-[760px] p-5`}>
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-mute">Example prompt</div>
            <p className="mt-2 font-mono text-[13px] leading-relaxed text-fg">{useCase.prompt}</p>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto w-full max-w-[760px] px-5 py-12">
          <h2 id="faq" className="mb-8 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]">
            Questions
          </h2>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel/95 ring-1 ring-line">
            {useCase.faq.map((f) => (
              <details key={f.q} className="group px-6 py-4" open>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-fg">
                  <h3>{f.q}</h3>
                  <ChevronDown className="size-4 shrink-0 text-mute transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-mute">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[760px] px-5 pb-20 pt-6 text-center">
          <p className="text-[15px] text-[color:var(--hero-fg-mute)]">Paste your website and see your film.</p>
          <div className="mt-5">
            <MakeVideoLink />
          </div>
          <p className="mt-6 text-sm text-[color:var(--hero-fg-mute)]">
            Other uses:{" "}
            {USE_CASES.filter((u) => u.slug !== useCase.slug).map((u, i, rest) => (
              <span key={u.slug}>
                <Link href={`/for/${u.slug}`} className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
                  {u.name}
                </Link>
                {i < rest.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
          <p className="mt-3 text-sm text-[color:var(--hero-fg-mute)]">
            <Link href="/alternatives" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              How {SITE_NAME} compares with other AI video tools
            </Link>
          </p>
        </section>
      </main>
    </PageShell>
  );
}
