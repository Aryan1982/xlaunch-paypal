/**
 * What the public site says about XLaunch, in one place: the home page, its
 * structured data (JSON-LD), the share cards and /llms.txt all read from here,
 * so search engines and AI answer engines see the same facts people do.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://xlaunch.pro").replace(/\/$/, "");
export const SITE_NAME = "XLaunch";
export const TAGLINE = "Launch videos from your website";
export const DESCRIPTION =
  "XLaunch turns your website into a launch video. Paste your product's URL: it reads the site, writes the story and a voice-over, and builds every scene in code, in your brand, as 2D motion graphics or a 3D film. Edit anything by chat and export an MP4.";
export const SHORT_DESCRIPTION = "Paste your website, get a custom launch video with a voice-over. 2D motion graphics or 3D, editable by chat, export to MP4.";

/** The home page's <title> and share title: one title, with the words people search for. */
export const HOME_TITLE = "AI Launch Video Maker: Turn Your Website into a Product Video | XLaunch";

export const STEPS = [
  { title: "Paste your website", body: "Describe the video you want and include your product's URL. Attach screenshots if you like." },
  { title: "It writes the story and the scenes", body: "XLaunch reads your site, writes a short film and its narration around what your product does, and builds every scene in code in your colours and fonts, in step with the voice." },
  { title: "Edit by chat, export the MP4", body: "Ask for any change in plain words, preview it live, then export the MP4." },
];

/** The refund promise, word for word wherever it's stated (pricing, FAQ, /refunds, /terms). */
export const GUARANTEE =
  "First-purchase guarantee: if your first purchase isn't for you, email us within 7 days and we refund it in full, as long as you've used fewer than half of its credits.";

/** Plain questions and plain answers: shown on the page and published as FAQPage structured data. */
export const FAQ = [
  {
    q: "What is XLaunch?",
    a: "XLaunch is an AI launch video maker. You paste your product's website and it produces a short launch video for it: it reads the site, writes the story, and builds each scene as code in your brand. You can change anything by chatting with it and export the result as an MP4.",
  },
  {
    q: "Is there a free preview?",
    a: "Yes. Free preview · no card needed: sign in, paste your website, and you get the storyboard for your whole film and its voiced opening. You pay only to finish the whole film, from $15 for one video.",
  },
  {
    q: "How long does it take to make a video?",
    a: "Usually 10 to 20 minutes for a new video. A change asked for in chat takes a few minutes, and an export about a minute.",
  },
  {
    q: "What's the difference between 2D and 3D?",
    a: "2D videos are crisp motion graphics built around your product's real interface. 3D videos (in beta) are short films where every shot is built in 3D. Both are priced by the AI model you pick, not by the style.",
  },
  {
    q: "How much does it cost?",
    a: "XLaunch uses credits, and you pay for what the work uses: each video is charged what its AI model actually costs plus a small fee for rendering. Every video is 30 seconds, so the model you pick sets the price, and narration adds a little on top. The Credits page shows the typical cost per model, and the video counts on plans and packs are the average across models, narrated. One video costs $15 (550 credits, paid once): enough to finish your free preview, with room for small changes; plans start at $29 a month, and larger one-time packs start at $19. Questions in chat are free.",
  },
  {
    q: "Does the video have a voice-over?",
    a: "Yes, by default. XLaunch writes the story as a narration with real delivery (excitement, pauses, a quieter line where it fits), records it with a natural AI voice, adds captions and times every scene to what the voice says. You can switch narration off in the model menu before you generate; you can also turn the voice down or off later in the video's sound settings.",
  },
  {
    q: "What happens if a video fails?",
    a: "Its credits are refunded automatically. If you stop a video yourself while it is being made, you pay only for what it used so far.",
  },
  {
    q: "Can I get a refund?",
    a: `Yes, on your first purchase. ${GUARANTEE} Later purchases are not refunded. Credits never go to waste on a failed video: they come back automatically. You can cancel a plan at any time and keep it until the end of the period you paid for. See the refund policy for the details.`,
  },
  {
    q: "Do I own the videos?",
    a: "Yes. You own the videos you make with XLaunch and can use them anywhere: Product Hunt, X, LinkedIn, your landing page or ads.",
  },
  {
    q: "Can Claude or other AI agents make videos with XLaunch?",
    a: `Yes. XLaunch is an MCP server at ${SITE_URL}/api/mcp. In claude.ai or the Claude app, add it as a custom connector (Settings, then Connectors) and sign in to XLaunch; in Claude Code or another MCP client you can also connect with an API key. Claude can then create, revise and export videos for you, paid from your credits.`,
  },
];

export const MCP_COMMAND = `claude mcp add --transport http xlaunch ${SITE_URL}/api/mcp --header "Authorization: Bearer xl_..."`;
