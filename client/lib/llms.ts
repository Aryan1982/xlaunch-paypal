import { ALTERNATIVES, CHECKED_ON, xlaunchPrices } from "./alternatives";
import { getPricing } from "./pricing";
import { APP_URL, DESCRIPTION, FAQ, MCP_COMMAND, SITE_NAME, SITE_URL, STEPS, TAGLINE } from "./site";
import { USE_CASES } from "./use-cases";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

/**
 * The plain-text summary of XLaunch for AI assistants and answer engines (llmstxt.org): /llms.txt
 * links to the use-case and comparison pages; /llms-full.txt (`full`) also carries their whole
 * text, so an assistant can answer from one fetch.
 */
export async function llmsText({ full }: { full: boolean }): Promise<string> {
  const pricing = await getPricing();
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${TAGLINE}. ${DESCRIPTION}`,
    "",
    "## How it works",
    ...STEPS.map((s, i) => `${i + 1}. ${s.title}: ${s.body}`),
    "",
    "## Free preview",
    `Free preview · no card needed. Sign in, paste your website, and ${SITE_NAME} plans the whole film and builds its voiced opening, in about 10 minutes, so you can watch it and read the storyboard before you buy. Paying finishes the video.`,
    "",
  ];
  if (pricing) {
    lines.push(
      "## Pricing",
      `Credits, metered: work is charged what its AI model calls cost, plus ${pricing.costs.metered.videoFee} credits per video for rendering, so the model chosen sets the price. Typical ${pricing.costs.seconds}-second 2D video costs: ${(pricing.costs.lineup ?? pricing.costs.models["2d"]).filter((m) => !("available" in m) || m.available).map((m) => `${m.label} ~${m.video}`).join("; ")}. ${pricing.costs.narration ? `Narration (on by default) adds ~${pricing.costs.narration}. ` : ""}A chat change is about ${pricing.costs.change.perScene} credits per scene rewritten; questions are free. A failed video gets its credits back automatically. Full price list: ${SITE_URL}/pricing`,
      ...(pricing.offer ? [`${pricing.offer.name} for early users until ${pricing.offer.endsAt}; regular prices after that are given in brackets.`] : []),
      ...pricing.products.map((p) => {
        const regular = pricing.offer && p.regularPriceCents ? ` (regular ${usd(p.regularPriceCents)})` : "";
        return p.kind === "subscription"
          ? `- ${p.name}: ${usd(p.priceCents)} per ${p.interval}${regular}, ${p.credits.toLocaleString("en-US")} credits`
          : `- ${p.name} (one-time): ${usd(p.priceCents)}${regular}, ${p.credits.toLocaleString("en-US")} credits that never expire${p.sku === "pack_one" ? ". The pack to start with: pay once to finish your first video" : ""}`;
      }),
      ""
    );
  }
  lines.push(
    "## Refunds",
    "First-purchase guarantee: if your first purchase isn't for you, email aryanthakore24@gmail.com within 7 days and we refund it in full, as long as you've used fewer than half of its credits. A video that fails gets its credits back automatically. Later purchases are not refunded; a plan can be cancelled at any time and runs to the end of the period paid for.",
    ""
  );
  lines.push(
    "## Use from Claude (MCP)",
    `${SITE_NAME} is a remote MCP server at ${APP_URL}/api/mcp (Streamable HTTP). In claude.ai or the Claude app, add it as a custom connector and sign in to ${SITE_NAME} (OAuth); other clients can send an API key as a bearer token. Tools: create_video, get_video_status, confirm_brief, revise_video, confirm_revision, stop_video, export_video, get_download_url, list_videos, get_credits, buy_credits (a PayPal approval link for the human), check_purchase, finish_preview.`,
    "",
    "```",
    MCP_COMMAND,
    "```",
    "",
    "## FAQ",
    ...FAQ.flatMap((f) => [`### ${f.q}`, f.a, ""]),
    "## Use cases",
    ...USE_CASES.map((u) => `- [${u.name}](${SITE_URL}/for/${u.slug}): ${u.description}`),
    "",
    `## Comparisons (checked on ${CHECKED_ON})`,
    ...ALTERNATIVES.map((a) => `- [${SITE_NAME} vs ${a.name}](${SITE_URL}/alternatives/${a.slug}): ${a.description}`),
    ""
  );
  if (full) {
    for (const u of USE_CASES) {
      lines.push(
        `## ${u.h1}`,
        `Page: ${SITE_URL}/for/${u.slug}`,
        "",
        u.answer,
        "",
        ...u.points.map((p) => `- ${p.title}: ${p.body}`),
        "",
        `How to make ${u.one}:`,
        ...u.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.body}`),
        "",
        `Example prompt: "${u.prompt}"`,
        "",
        ...u.faq.flatMap((f) => [`### ${f.q}`, f.a, ""])
      );
    }
    for (const a of ALTERNATIVES) {
      lines.push(
        `## ${a.h1}`,
        `Page: ${SITE_URL}/alternatives/${a.slug} (${a.name}'s details from its own website, checked on ${CHECKED_ON})`,
        "",
        a.answer,
        "",
        ...a.rows.map((r) => `- ${r.label}: ${SITE_NAME}: ${r.us ?? xlaunchPrices(pricing)}. ${a.name}: ${r.them} (source: ${a.sources[r.source]?.url ?? "its website"})`),
        "",
        `Where ${SITE_NAME} fits:`,
        ...a.fits.map((f) => `- ${f}`),
        "",
        `Where ${a.name} is the better choice:`,
        ...a.better.map((b) => `- ${b}`),
        "",
        ...a.faq.flatMap((f) => [`### ${f.q}`, f.a, ""])
      );
    }
  }
  lines.push(
    "## Links",
    `- [Make a video](${SITE_URL}/)`,
    `- [Pricing](${SITE_URL}/pricing)`,
    `- [Example videos](${SITE_URL}/examples)`,
    `- [Use cases](${SITE_URL}/for)`,
    `- [Comparisons with other AI video tools](${SITE_URL}/alternatives)`,
    ...(full ? [] : [`- [Full text of the site for AI assistants](${SITE_URL}/llms-full.txt)`]),
    `- [Terms](${SITE_URL}/terms)`,
    `- [Privacy](${SITE_URL}/privacy)`,
    `- [Refund policy](${SITE_URL}/refunds)`,
    ""
  );
  return lines.join("\n");
}
