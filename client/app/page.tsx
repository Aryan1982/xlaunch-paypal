import type { Metadata } from "next";

import { HomeClient } from "@/components/home/HomeClient";
import { HomeSections } from "@/components/home/Sections";
import { getPricing, type Pricing } from "@/lib/pricing";
import { DESCRIPTION, FAQ, HOME_TITLE, SITE_NAME, SITE_URL, STEPS } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
};

/** Structured data for search and AI answer engines: who we are, what the product is and costs, and the FAQ. */
const jsonLd = (pricing: Pricing | null) => {
  const prices = pricing?.products.map((p) => p.priceCents / 100) ?? [];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/logo/icon.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: DESCRIPTION,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        description: DESCRIPTION,
        applicationCategory: "MultimediaApplication",
        applicationSubCategory: "Video generator",
        operatingSystem: "Web",
        image: `${SITE_URL}/opengraph-image.png`,
        publisher: { "@id": `${SITE_URL}/#organization` },
        featureList: [
          "Launch video from a website URL",
          "2D motion graphics or 3D films",
          "Built in your brand's colours and fonts",
          "Edit by chat",
          "MP4 export",
          "MCP server for Claude and AI agents",
        ],
        ...(prices.length
          ? {
              offers: {
                "@type": "AggregateOffer",
                priceCurrency: pricing!.currency,
                lowPrice: Math.min(...prices),
                highPrice: Math.max(...prices),
                offerCount: prices.length,
                url: `${SITE_URL}/#pricing`,
              },
            }
          : {}),
      },
      {
        "@type": "HowTo",
        name: `How to make a launch video with ${SITE_NAME}`,
        step: STEPS.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.title, text: s.body })),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };
};

export default async function Home() {
  const pricing = await getPricing();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(pricing)).replace(/</g, "\\u003c") }}
      />
      <HomeClient>
        <HomeSections pricing={pricing} />
      </HomeClient>
    </>
  );
}
