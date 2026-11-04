import type { Metadata } from "next";
import Link from "next/link";

import { MakeVideoLink, PageShell } from "@/components/home/PageShell";
import { ALTERNATIVES, CHECKED_ON, xlaunchPrices } from "@/lib/alternatives";
import { getPricing } from "@/lib/pricing";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const revalidate = 600;

const TITLE = "XLaunch alternatives and comparisons for launch videos";
const DESCRIPTION = `${SITE_NAME} compared with HeyGen, Synthesia, invideo AI, Pictory and Arcade for a product launch video: what each makes, what it costs, and when to pick which.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/alternatives" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/alternatives", type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const FAQ = [
  {
    q: "What is the best tool for a product launch video?",
    a: `It depends on the video. For a presenter on screen, avatar tools such as HeyGen and Synthesia are built for it. To turn articles or recordings into many videos, Pictory and invideo AI fit. For a marketing team making many on-brand videos, Arcade. For a short launch film of your product made from your website, 2D or 3D, ${SITE_NAME}.`,
  },
  {
    q: `How were these comparisons made?`,
    a: `Each tool's features and prices come from its own website, linked on its page, as checked on ${CHECKED_ON}. Every page also says where the other tool is the better choice.`,
  },
];

const panel = "rounded-2xl bg-panel/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line";

export default async function AlternativesPage() {
  const prices = xlaunchPrices(await getPricing());
  const url = `${SITE_URL}/alternatives`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        url,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
        dateModified: CHECKED_ON,
        hasPart: ALTERNATIVES.map((a) => ({ "@type": "WebPage", url: `${url}/${a.slug}`, name: a.title })),
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Alternatives", item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-16">
        <div className="text-center">
          <h1 className="text-balance text-[32px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[44px]">{SITE_NAME} compared</h1>
          <p className="mx-auto mt-4 max-w-[680px] text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]">
            Many AI video tools can make something for a launch. Most are built for a different kind of video: a presenter reading a script, stock footage over a
            voice-over, or a team&rsquo;s steady flow of marketing clips. {SITE_NAME} makes one thing: a short launch film of your product, built from your website as 2D
            motion graphics or a 3D film. These pages say what each tool does, what it costs, and when it is the better pick.
          </p>
        </div>

        <div className={`${panel} mx-auto mt-10 max-w-[760px] p-6`}>
          <h2 className="text-[17px] font-medium text-fg">{SITE_NAME} in short</h2>
          <p className="mt-2 text-sm leading-relaxed text-mute">
            Paste your product&rsquo;s URL; {SITE_NAME} reads the site, writes the story and a voice-over, and builds every scene in code in your colours and fonts. Change
            anything by chat, export an MP4. Free preview · no card needed. {prices}. If your first purchase isn&rsquo;t for you, email us within 7 days for a full refund, as
            long as you&rsquo;ve used fewer than half of its credits.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ALTERNATIVES.map((a) => (
            <li key={a.slug}>
              <Link href={`/alternatives/${a.slug}`} className={`${panel} block h-full p-6 transition-colors hover:ring-line-hi`}>
                <h2 className="text-[17px] font-medium text-fg">
                  {SITE_NAME} vs {a.name}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-mute">{a.summary}</p>
              </Link>
            </li>
          ))}
        </ul>

        <section aria-labelledby="faq" className="mx-auto mt-16 max-w-[760px]">
          <h2 id="faq" className="mb-6 text-center text-[26px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[30px]">
            Questions
          </h2>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel/95 ring-1 ring-line">
            {FAQ.map((f) => (
              <div key={f.q} className="px-6 py-4">
                <h3 className="text-[15px] font-medium text-fg">{f.q}</h3>
                <p className="mt-3 text-sm leading-relaxed text-mute">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 text-center">
          <MakeVideoLink />
          <p className="mt-6 text-sm text-[color:var(--hero-fg-mute)]">
            <Link href="/examples" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              Watch example videos
            </Link>{" "}
            ·{" "}
            <Link href="/for" className="underline-offset-2 hover:text-[color:var(--hero-fg)] hover:underline">
              Use cases
            </Link>
          </p>
        </div>
      </main>
    </PageShell>
  );
}
