/**
 * The comparison pages (/alternatives/<slug>): XLaunch next to another video tool people
 * consider for a launch or product video. Every fact about the other tool comes from its own
 * site, linked in `sources` and checked on CHECKED_ON; re-check them before changing a page.
 * Say where the other tool is the better choice: these pages are for people deciding, not ads.
 * XLaunch's own price comes from the live price list on the page itself.
 */

import type { Pricing } from "./pricing";

export const CHECKED_ON = "2026-10-21";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** XLaunch's prices in one line, from the live price list: the cheapest pack and the cheapest monthly plan. */
export const xlaunchPrices = (pricing: Pricing | null): string => {
  const pack = pricing?.products.filter((p) => p.kind === "pack").sort((a, b) => a.priceCents - b.priceCents)[0];
  const plan = pricing?.products.filter((p) => p.kind === "subscription" && p.interval === "month").sort((a, b) => a.priceCents - b.priceCents)[0];
  if (!pack || !plan) return "See the pricing page";
  const offer = pricing?.offer ? ` (launch prices until ${pricing.offer.endsAt})` : "";
  const packName = /pack$/i.test(pack.name) ? pack.name : `${pack.name} pack`;
  return `${packName}: ${usd(pack.priceCents)} once, ${pack.credits.toLocaleString("en-US")} credits that never expire. Plans from ${usd(plan.priceCents)}/month${offer}, ${plan.credits.toLocaleString("en-US")} credits a month`;
};

export type Source = { label: string; url: string };

export type Alternative = {
  slug: string;
  /** The other tool's name. */
  name: string;
  /** <title> (the site name is appended) and the share title. */
  title: string;
  description: string;
  h1: string;
  /** The answer-first paragraph under the heading. */
  answer: string;
  /** What the other tool is, in one line, for the hub page. */
  summary: string;
  /** The comparison: one row per question, the other tool's answer with the source it comes from (an index into `sources`); no `us`: XLaunch's live prices. */
  rows: Array<{ label: string; them: string; us?: string; source: number }>;
  /** Where XLaunch is the better fit. */
  fits: string[];
  /** Where the other tool is the better fit. */
  better: string[];
  faq: Array<{ q: string; a: string }>;
  sources: Source[];
};

/** XLaunch's side of rows that recur on every page. */
const US = {
  makes: "Launch videos made from your website: 2D motion graphics of your product, or a 3D film, with a voice-over and captions",
  start: "Your website's URL and a sentence on what the video is for; screenshots optional",
  free: "Free preview · no card needed: the storyboard of the whole film and its voiced opening",
  model: "Credits, metered: the AI model you pick sets the price. One-time packs never expire; a failed video gets its credits back",
  length: "About 30 seconds, landscape (16:9) or vertical (9:16)",
  edit: "Ask for any change in chat; every scene is rebuilt in code",
  export: "MP4 export",
  agents: "MCP server: Claude can make, revise and export videos",
  refunds: "First purchase: full refund within 7 days if you've used fewer than half of its credits",
};

export const ALTERNATIVES: Alternative[] = [
  {
    slug: "heygen",
    name: "HeyGen",
    title: "HeyGen alternative for launch videos: XLaunch vs HeyGen",
    description: "XLaunch and HeyGen compared for a product launch video: what each makes, what it costs, and when HeyGen's AI presenters are the better choice.",
    h1: "XLaunch vs HeyGen for a launch video",
    answer:
      "HeyGen is best known for AI avatar videos: a presenter who speaks your script, in many languages. XLaunch has no presenter. It reads your product's website and builds a launch video around the product itself, as 2D motion graphics or a 3D film, with a voice-over. Choose HeyGen when you want a person on screen or videos in many languages; choose XLaunch when you want a short launch film in your brand from just your URL, from $15 for one video.",
    summary: "AI presenter (avatar) videos, product videos and translation in many languages.",
    rows: [
      { label: "What it makes", them: "AI avatar and presenter videos, plus product demos, ads and launch videos", us: US.makes, source: 1 },
      { label: "Where you start", them: "A prompt, a script, product photos or a product page URL", us: US.start, source: 1 },
      { label: "Presenter on screen", them: "Yes: over 500 ready-made presenters, and a custom avatar with your own voice and likeness", us: "No presenter: the product and the narration carry the film", source: 0 },
      { label: "Free option", them: "Free plan: 3 videos a month with a watermark, up to 1 minute each", us: US.free, source: 0 },
      { label: "Paid plans", them: "Creator $29/month (600 credits), Pro $49/month (1,000 credits), Business $149/month (1,500 credits); yearly billing gives 2 months free", source: 0 },
      { label: "Video length", them: "Up to 30 minutes on Creator and Pro, 60 on Business", us: US.length, source: 0 },
      { label: "Languages", them: "Over 175 languages and dialects on Creator and up", us: "One narration per video; no translation or dubbing", source: 0 },
      { label: "Export", them: "1080p on Creator, 4K on Pro", us: US.export, source: 0 },
    ],
    fits: [
      "You want a launch video of your product, not a person talking: XLaunch rebuilds your interface and brand from your site.",
      "You want one video without a subscription: the One video pack is $15, and its credits never expire.",
      "You want a 3D film for a bigger moment, or to make and revise videos from Claude over MCP.",
    ],
    better: [
      "You want a presenter on camera, including an avatar of yourself.",
      "You need the same video in many languages, with lip-synced translation.",
      "You make long videos (training, walkthroughs) or need 4K and team features such as SSO and a shared workspace.",
    ],
    faq: [
      { q: "Is XLaunch a HeyGen alternative?", a: "For launch and promo videos of a software product, yes. XLaunch makes the film from your website, with your interface and brand animated and a voice-over. It doesn't make avatar or presenter videos, which is what HeyGen is known for." },
      { q: "Which is cheaper for one launch video?", a: "XLaunch sells a single video for $15 with the One video pack, with no subscription. HeyGen's paid plans start at $29 a month (Creator), and its free plan makes up to 3 watermarked videos a month, each up to a minute." },
      { q: "Can HeyGen make a video from my website too?", a: "Yes. HeyGen says you can drop in a product page link and it builds a storyboard from the page's details, images and copy. XLaunch is built only for that: it reads your site, writes the story and builds each scene in code in your colours and fonts." },
    ],
    sources: [
      { label: "HeyGen pricing", url: "https://www.heygen.com/pricing" },
      { label: "HeyGen AI product video generator", url: "https://www.heygen.com/tool/ai-product-video-generator" },
    ],
  },
  {
    slug: "synthesia",
    name: "Synthesia",
    title: "Synthesia alternative for product launch videos: XLaunch vs Synthesia",
    description: "XLaunch and Synthesia compared for a product launch video: inputs, AI avatars, free plans and prices, and when Synthesia is the better choice.",
    h1: "XLaunch vs Synthesia for a launch video",
    answer:
      "Synthesia is a business video platform built around AI avatars and voiceovers, used for training, onboarding and explainers, with dubbing, surveys and learner seats. XLaunch makes one kind of video: a short launch film of your product, built from your website as 2D motion graphics or a 3D film. Choose Synthesia for presenter-led training and internal videos at scale; choose XLaunch for a launch video in your brand, from $15 for one video.",
    summary: "Business videos with AI avatars: training, onboarding, explainers and dubbing.",
    rows: [
      { label: "What it makes", them: "Business videos with AI avatars and voiceovers, plus dubbing, interactive videos, surveys and roleplays", us: US.makes, source: 0 },
      { label: "Where you start", them: "An idea, a script, a URL (article, blog or web page) or a file", us: US.start, source: 1 },
      { label: "Presenter on screen", them: "Yes: 125+ stock avatars on Starter; 180+ and 5 personal avatars on Pro", us: "No presenter: the product and the narration carry the film", source: 0 },
      { label: "Free option", them: "Basic: $0, 10 minutes of video creation or dubbing a month, with a Synthesia watermark", us: US.free, source: 0 },
      { label: "Paid plans", them: "Starter $29/month (1,250 credits, about 12 minutes of video), Pro $89/month (6,000 credits, about 60 minutes), Enterprise custom", source: 0 },
      { label: "How it charges", them: "Monthly or yearly plans; credits are one pool across video, dubbing and surveys", us: US.model, source: 0 },
      { label: "Download", them: "Downloading your videos and removing the logo start on Starter", us: US.export, source: 0 },
    ],
    fits: [
      "You want a launch or promo video of your product rather than a presenter: XLaunch animates your interface in your brand.",
      "You want a finished video from just your URL, without writing a script or choosing an avatar.",
      "You make one video at a time: $15 for one, no subscription, credits that never expire.",
    ],
    better: [
      "You make training, onboarding or internal videos with a presenter, at volume.",
      "You need dubbing, interactive videos, surveys or learner seats.",
      "You need enterprise features and custom credit volumes.",
    ],
    faq: [
      { q: "Is XLaunch a Synthesia alternative?", a: "For a product launch video, yes: XLaunch makes a short film of your product from your website. For presenter-led training and internal communication, Synthesia is built for that and XLaunch is not." },
      { q: "Can Synthesia turn a website into a video?", a: "Synthesia has a URL to video tool that turns an article, blog or web page into an AI video. XLaunch reads a product's website to build a launch film: the story, the voice-over and every scene in the product's colours and fonts." },
      { q: "Which has a free option?", a: "Both. Synthesia's Basic plan is free with 10 minutes a month and a watermark. XLaunch gives a free preview with no card: it plans your whole film and builds the voiced opening before you buy." },
    ],
    sources: [
      { label: "Synthesia pricing", url: "https://www.synthesia.io/pricing" },
      { label: "Synthesia URL to video", url: "https://www.synthesia.io/tools/url-to-video" },
    ],
  },
  {
    slug: "invideo",
    name: "invideo AI",
    title: "invideo AI alternative for launch videos: XLaunch vs invideo AI",
    description: "XLaunch and invideo AI compared for a product launch video: how each builds the video, prices and free use, and when invideo is the better choice.",
    h1: "XLaunch vs invideo AI for a launch video",
    answer:
      "invideo AI turns a prompt or a link into a video from stock footage, AI-generated clips and images, and AI voiceovers, with a timeline editor for finishing. XLaunch builds a launch video of your product from your website: your interface, colours and fonts animated in code as 2D motion graphics, or a 3D film. Choose invideo for YouTube, social and UGC-style ad videos with stock or generated footage; choose XLaunch for a launch film that shows your actual product, from $15 for one video.",
    summary: "Prompt or link to video with stock footage, generated clips and AI voices.",
    rows: [
      { label: "What it makes", them: "Videos from stock footage, AI-generated video and images, and AI voiceovers; UGC-style product videos from a link", us: US.makes, source: 1 },
      { label: "Where you start", them: "A prompt, or a link such as an article or a product page", us: US.start, source: 1 },
      { label: "Footage", them: "16 million+ stock photos and videos, plus generative models such as Seedance on paid plans", us: "Every scene built in code from your product and brand; no stock footage", source: 1 },
      { label: "Free option", them: "Free use without a card, with limited credits", us: US.free, source: 2 },
      { label: "Paid plans", them: "Basic $9, Pro $30 and Ultra $80 per seat a month billed monthly (190, 1,000 and 3,000 credits); about half that billed yearly", source: 0 },
      { label: "Editing", them: "Text commands in a magic edit box, and a timeline editor", us: US.edit, source: 1 },
      { label: "Voices", them: "AI voiceovers in over 50 languages", us: "A written narration recorded with a natural AI voice, with captions", source: 1 },
    ],
    fits: [
      "You want the video to show your actual product: XLaunch rebuilds your screens from your site instead of using stock clips.",
      "You want it on brand without setting anything up: colours, fonts, logo and wording come from your website.",
      "You want one launch video without a subscription: $15 with the One video pack.",
    ],
    better: [
      "You make YouTube, social or faceless channel videos, where stock or generated footage fits.",
      "You want UGC-style ads for e-commerce products.",
      "You want to finish videos by hand on a timeline, with a team on one plan.",
    ],
    faq: [
      { q: "Is XLaunch an invideo AI alternative?", a: "For a software or app launch video, yes. invideo builds videos from stock and generated footage; XLaunch builds each scene in code from your product's website, so the film shows your interface and brand." },
      { q: "Can I try either for free?", a: "Yes. invideo AI can be used for free without a card, with limited credits. XLaunch gives a free preview with no card: the storyboard of your whole film and its voiced opening." },
      { q: "Which is cheaper?", a: "For a single launch video, XLaunch's One video pack is $15, paid once with no subscription. invideo's paid plans start at $9 a month per seat (Basic, 190 credits) billed monthly. Which costs less overall depends on how many videos you make." },
    ],
    sources: [
      { label: "invideo AI pricing", url: "https://invideo.io/pricing/" },
      { label: "invideo AI link to video", url: "https://invideo.io/make/link-to-video/" },
      { label: "invideo Help Center: Can I use invideo AI for free?", url: "https://help.invideo.io/en/articles/9380226-can-i-use-invideo-ai-for-free" },
    ],
  },
  {
    slug: "pictory",
    name: "Pictory",
    title: "Pictory alternative for launch videos: XLaunch vs Pictory",
    description: "XLaunch and Pictory compared for a product launch video: inputs, footage, prices and free trial, and when Pictory is the better choice.",
    h1: "XLaunch vs Pictory for a launch video",
    answer:
      "Pictory turns scripts, articles, URLs, documents, slides and recordings into videos, using stock footage from Getty Images and Storyblocks, AI voices and captions. XLaunch makes a launch video of your product from your website, building every scene in code in your brand as 2D motion graphics or a 3D film. Choose Pictory to turn written content and recordings into many videos a month; choose XLaunch for a launch film that shows your product, from $15 for one video.",
    summary: "Text, URL, document and recording to video, with stock footage and captions.",
    rows: [
      { label: "What it makes", them: "Videos from text, links, documents and recordings, with stock footage, AI voices, captions and clips", us: US.makes, source: 0 },
      { label: "Where you start", them: "An idea, a URL, a script, a document, PDF or PowerPoint, audio, or a screen or camera recording", us: US.start, source: 0 },
      { label: "Footage", them: "Millions of stock videos from Getty Images and Storyblocks (5 million on Starter, 18 million on Professional)", us: "Every scene built in code from your product and brand; no stock footage", source: 0 },
      { label: "Free option", them: "Free trial", us: US.free, source: 0 },
      { label: "Paid plans", them: "Starter $25/month, Professional $35/month, Team $119/month billed yearly ($29, $59 and $199 billed monthly)", source: 0 },
      { label: "How it charges", them: "Plans include video minutes a year (2,400 on Starter) plus AI credits for images, video and avatars", us: US.model, source: 0 },
      { label: "Voices", them: "ElevenLabs AI voices in 29 languages (720 minutes a year on Starter)", us: "A written narration recorded with a natural AI voice, with captions", source: 0 },
    ],
    fits: [
      "You want your product on screen, not stock clips: XLaunch rebuilds your interface from your site.",
      "You need one launch video, not a monthly volume of minutes: $15 with the One video pack.",
      "You want a 3D film, or to make videos from Claude over MCP.",
    ],
    better: [
      "You turn blog posts, articles, documents or slides into videos regularly.",
      "You edit long recordings into highlights and clips, with captions.",
      "You want a large stock library and many voice languages.",
    ],
    faq: [
      { q: "Is XLaunch a Pictory alternative?", a: "For a product launch video, yes. Pictory assembles videos from your text and stock footage; XLaunch builds the film from your product's website, with your interface and brand animated in code." },
      { q: "Can Pictory make a video from a URL?", a: "Yes, Pictory has URL to video. It suits articles and blog posts. XLaunch reads a product's site to write a launch story and build scenes of the product itself." },
      { q: "Which costs less?", a: "For a single launch video, XLaunch's One video pack is $15 with no subscription. Pictory's plans start at $25 a month billed yearly, or $29 billed monthly, and include many minutes of video, which suits regular content." },
    ],
    sources: [{ label: "Pictory pricing", url: "https://pictory.ai/pricing" }],
  },
  {
    slug: "arcade",
    name: "Arcade",
    title: "Arcade AI video alternative: XLaunch vs Arcade for launch videos",
    description: "XLaunch and Arcade compared for a product launch video: how each starts, credits and prices, length and export, and when Arcade is the better choice.",
    h1: "XLaunch vs Arcade for a launch video",
    answer:
      "Arcade is an AI video platform for marketing teams: launch videos, changelogs, tutorials and social clips built from a prompt, your brand kit and your product captured with its Chrome extension, editable by AI or on a timeline. It also sells interactive demos separately. XLaunch is closest to Arcade of the tools here. It starts from your website alone, can make a 3D film, and sells one video for $15 without a subscription. Choose Arcade for a team making many videos, longer ones or 4K; choose XLaunch for a launch film from your URL without a plan.",
    summary: "AI videos for marketing teams, from a prompt, a brand kit and captured product screens.",
    rows: [
      { label: "What it makes", them: "Launch videos, changelogs, tutorials, talking-head and article-to-video clips; interactive demos are a separate product", us: US.makes, source: 1 },
      { label: "Where you start", them: "A prompt, your brand kit, and your product captured with the Arcade Chrome extension or your Arcade demos", us: US.start, source: 2 },
      { label: "Free option", them: "Free: 250 credits, one time; videos up to 30 seconds, 1080p, with an Arcade watermark", us: US.free, source: 0 },
      { label: "Paid plans", them: "Pro $59/month, or $49/month billed yearly: 1,000 credits a month, up to 10 seats. Enterprise custom. No one-off credit packs", source: 0 },
      { label: "How it charges", them: "Credits by model and length: up to 30 s costs 60 (Gemini 3.8), 80 (Claude Sonnet 5.5) or 100 (Claude Opus 5.5) credits; AI edits 30 to 75; your own edits and exports are free", us: US.model, source: 0 },
      { label: "Video length", them: "Up to 30 seconds on Free, 5 minutes on Pro", us: US.length, source: 0 },
      { label: "Editing", them: "Ask AI to change any scene, or edit the timeline yourself", us: US.edit, source: 1 },
      { label: "Export", them: "1080p on Free, 4K on Pro", us: US.export, source: 0 },
      { label: "AI agents", them: "Arcade MCP: ask for a video in Claude, ChatGPT and more", us: US.agents, source: 1 },
      { label: "Refunds", them: "Credits have no cash value and are not refunded", us: US.refunds, source: 0 },
    ],
    fits: [
      "You want to start from just your website: no extension, recording or brand kit to set up first.",
      "You want one video without a plan: the One video pack is $15, and pack credits never expire.",
      "You want a 3D launch film, not only motion graphics.",
    ],
    better: [
      "A marketing team makes many videos a month and wants up to 10 seats on one plan.",
      "You need videos longer than a minute, or 4K.",
      "You want to capture your real product with a browser extension, edit on a timeline, or also run interactive demos.",
    ],
    faq: [
      { q: "Is XLaunch an Arcade alternative?", a: "Yes, for launch videos. Both build on-brand videos with AI that you can change by asking. Arcade suits a team making many kinds of marketing video; XLaunch makes launch videos from your website, including 3D films, and sells one at a time." },
      { q: "Which is cheaper for one video?", a: "XLaunch's One video pack is $15 for one video, with no subscription. Arcade's Free plan gives 250 credits once, for videos up to 30 seconds with a watermark; its Pro plan is $59 a month, or $49 a month billed yearly, and it doesn't sell one-off credit packs." },
      { q: "Can I use either from Claude?", a: "Yes. Arcade has an MCP server for Claude, ChatGPT and other assistants. XLaunch is an MCP server too: Claude can create, revise and export videos, paid from your credits." },
    ],
    sources: [
      { label: "Arcade pricing", url: "https://www.arcade.software/pricing" },
      { label: "Arcade home page", url: "https://www.arcade.software/" },
      { label: "Arcade docs: Welcome to AI Video", url: "https://docs.arcade.software/kb/ai-video" },
    ],
  },
];
