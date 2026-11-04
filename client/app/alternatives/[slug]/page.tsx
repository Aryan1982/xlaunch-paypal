import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { MakeVideoLink, PageShell } from "@/components/home/PageShell";
import { ALTERNATIVES, CHECKED_ON, xlaunchPrices } from "@/lib/alternatives";
import { getPricing } from "@/lib/pricing";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const dynamicParams = false;
export const revalidate = 600;

export const generateStaticParams = () => ALTERNATIVES.map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: PageProps<"/alternatives/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const alt = ALTERNATIVES.find((a) => a.slug === slug);
  if (!alt) return {};
  return {
    title: alt.title,
    description: alt.description,
    alternates: { canonical: `/alternatives/${alt.slug}` },
    openGraph: { title: alt.title, description: alt.description, url: `/alternatives/${alt.slug}`, type: "website" },
    twitter: { title: alt.title, description: alt.description },
  };
}

const panel = "rounded-2xl bg-panel/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line";
const h2 = "mb-8 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]";
const checked = new Date(`${CHECKED_ON}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function AlternativePage({ params }: PageProps<"/alternatives/[slug]">) {
  const { slug } = await params;
  const alt = ALTERNATIVES.find((a) => a.slug === slug);
  if (!alt) notFound();
  const url = `${SITE_URL}/alternatives/${alt.slug}`;
  const prices = xlaunchPrices(await getPricing());

  // the same structured data as the use-case pages: the page, where it sits, its questions
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#page`,
        url,
        name: alt.title,
        description: alt.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
        dateModified: CHECKED_ON,
        citation: alt.sources.map((s) => s.url),
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Alternatives", item: `${SITE_URL}/alternatives` },
          { "@type": "ListItem", position: 3, name: `${SITE_NAME} vs ${alt.name}`, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: alt.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <section className="mx-auto w-full max-w-[860px] px-5 pb-12 pt-16 text-center">
          <nav aria-label="Breadcrumb" className="text-xs text-[color:var(--hero-fg-mute)]">
            <Link href="/alternatives" className="hover:text-[color:var(--hero-fg)]">
              Alternatives
            </Link>{" "}
            / {alt.name}
          </nav>
          <h1 className="mt-3 text-balance text-[32px] font-medium leading-[1.12] tracking-tight text-[color:var(--hero-fg)] sm:text-[44px]">{alt.h1}</h1>
          <p className="mx-auto mt-5 max-w-[680px] text-pretty text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]">{alt.answer}</p>
          <div className="mt-8">
            <MakeVideoLink />
          </div>
          <p className="mt-3 text-xs text-[color:var(--hero-fg-mute)]">Free preview · no card needed</p>
        </section>

        <section aria-labelledby="compare" className="mx-auto w-full max-w-[1120px] px-5 py-12">
          <h2 id="compare" className={h2}>
            {SITE_NAME} and {alt.name} side by side
          </h2>
          <div className={`${panel} overflow-x-auto`}>
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-fg">
                  <th scope="col" className="w-[18%] px-5 py-4 font-medium">
                    <span className="sr-only">Question</span>
                  </th>
                  <th scope="col" className="w-[41%] px-5 py-4 font-medium">
                    {SITE_NAME}
                  </th>
                  <th scope="col" className="w-[41%] px-5 py-4 font-medium">
                    {alt.name}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {alt.rows.map((row) => {
                  const source = alt.sources[row.source];
                  return (
                    <tr key={row.label} className="align-top">
                      <th scope="row" className="px-5 py-4 font-medium text-fg">
                        {row.label}
                      </th>
                      <td className="px-5 py-4 leading-relaxed text-mute">{row.us ?? prices}</td>
                      <td className="px-5 py-4 leading-relaxed text-mute">
                        {row.them}
                        {source && (
                          <>
                            {" "}
                            <a href={source.url} rel="nofollow noopener" target="_blank" className="whitespace-nowrap text-xs underline underline-offset-2 hover:text-fg">
                              source
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-xs text-[color:var(--hero-fg-mute)]">
            {alt.name}&rsquo;s details are from its own website, as checked on {checked}. Prices are in US dollars and can change; check its site before you buy.
          </p>
          <p className="mt-2 text-center text-xs text-[color:var(--hero-fg-mute)]">
            {SITE_NAME}: a video that fails gets its credits back, and if your first purchase isn&rsquo;t for you, email us within 7 days for a full refund, as long as you&rsquo;ve used
            fewer than half of its credits.
          </p>
        </section>

        <section aria-label="Which to choose" className="mx-auto grid w-full max-w-[1120px] gap-4 px-5 py-12 sm:grid-cols-2">
          <div className={`${panel} p-6`}>
            <h2 className="text-[19px] font-medium text-fg">Where {SITE_NAME} fits</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-mute">
              {alt.fits.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className={`${panel} p-6`}>
            <h2 className="text-[19px] font-medium text-fg">Where {alt.name} is the better choice</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-mute">
              {alt.better.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto w-full max-w-[760px] px-5 py-12">
          <h2 id="faq" className={h2}>
            Questions
          </h2>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel/95 ring-1 ring-line">
            {alt.faq.map((f) => (
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

        <section aria-labelledby="sources" className="mx-auto w-full max-w-[760px] px-5 py-6">
          <h2 id="sources" className="text-[15px] font-medium text-[color:var(--hero-fg)]">
            Sources (checked on {checked})
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-[color:var(--hero-fg-mute)]">
            {alt.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="nofollow noopener" target="_blank" className="underline underline-offset-2 hover:text-[color:var(--hero-fg)]">
                  {s.label}
                </a>
              </li>
            ))}
            <li>
              {SITE_NAME}:{" "}
              <Link href="/pricing" className="underline underline-offset-2 hover:text-[color:var(--hero-fg)]">
                pricing
              </Link>{" "}
              and{" "}
              <Link href="/refunds" className="underline underline-offset-2 hover:text-[color:var(--hero-fg)]">
                refund policy
              </Link>
            </li>
          </ul>
        </section>

        <section className="mx-auto w-full max-w-[760px] px-5 pb-20 pt-10 text-center">
          <p className="text-[15px] text-[color:var(--hero-fg-mute)]">Paste your website and see your film before you pay.</p>
          <div className="mt-5">
            <MakeVideoLink />
          </div>
          <p className="mt-6 text-sm text-[color:var(--hero-fg-mute)]">
            Other comparisons:{" "}
            {ALTERNATIVES.filter((a) => a.slug !== alt.slug).map((a, i, rest) => (
              <span key={a.slug}>
                <Link href={`/alternatives/${a.slug}`} className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
                  {SITE_NAME} vs {a.name}
                </Link>
                {i < rest.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
          <p className="mt-3 text-sm text-[color:var(--hero-fg-mute)]">
            <Link href="/examples" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              Watch example videos
            </Link>{" "}
            ·{" "}
            <Link href="/for" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              Use cases
            </Link>
          </p>
        </section>
      </main>
    </PageShell>
  );
}
