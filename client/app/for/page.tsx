import type { Metadata } from "next";
import Link from "next/link";

import { MakeVideoLink, PageShell } from "@/components/home/PageShell";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { USE_CASES } from "@/lib/use-cases";

const TITLE = "Launch videos for every kind of product";
const DESCRIPTION = `What people make with ${SITE_NAME}: launch videos for SaaS, Product Hunt launches, mobile apps, developer tools and startups, made from a website.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/for" },
};

export default function UseCasesPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    url: `${SITE_URL}/for`,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasPart: USE_CASES.map((u) => ({ "@type": "WebPage", url: `${SITE_URL}/for/${u.slug}`, name: u.title })),
  };
  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-16">
        <div className="text-center">
          <h1 className="text-balance text-[32px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[44px]">{TITLE}</h1>
          <p className="mx-auto mt-4 max-w-[640px] text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]">{DESCRIPTION}</p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((u) => (
            <li key={u.slug}>
              <Link
                href={`/for/${u.slug}`}
                className="block h-full rounded-2xl bg-panel/95 p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line transition-colors hover:ring-line-hi"
              >
                <h2 className="text-[17px] font-medium text-fg">{u.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-mute">{u.description}</p>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-12 text-center">
          <MakeVideoLink />
          <p className="mt-6 text-sm text-[color:var(--hero-fg-mute)]">
            <Link href="/examples" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              Watch example videos
            </Link>{" "}
            ·{" "}
            <Link href="/alternatives" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              How {SITE_NAME} compares with HeyGen, Synthesia, invideo AI, Pictory and Arcade
            </Link>
          </p>
        </div>
      </main>
    </PageShell>
  );
}
