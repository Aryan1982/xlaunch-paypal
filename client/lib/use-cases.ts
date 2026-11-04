/**
 * The use-case pages (/for/<slug>): one per kind of product people make launch videos for. Each
 * leads with a direct answer (what search snippets and AI answer engines quote), then why XLaunch
 * fits, how to make one, and its own questions, published as FAQPage structured data. Every claim
 * here must be true of the product; general facts live in lib/site.ts.
 */

export type UseCase = {
  slug: string;
  /** What the page is called in lists and the breadcrumb. */
  name: string;
  /** One of them, with its article: "a SaaS launch video". */
  one: string;
  /** <title> (the site name is appended) and the share title. */
  title: string;
  description: string;
  h1: string;
  /** The answer-first paragraph under the heading. */
  answer: string;
  /** Why XLaunch fits this kind of product: three short points. */
  points: Array<{ title: string; body: string }>;
  /** How to make one: steps specific to this kind of product. */
  steps: Array<{ title: string; body: string }>;
  /** An example prompt for this kind of product. */
  prompt: string;
  faq: Array<{ q: string; a: string }>;
};

export const USE_CASES: UseCase[] = [
  {
    slug: "saas",
    name: "SaaS launch videos",
    one: "a SaaS launch video",
    title: "SaaS launch video maker: from your website, in your brand",
    description:
      "Make a SaaS launch video from your website: your real interface as motion graphics, a written story and voice-over, in your brand. Edit by chat, export an MP4.",
    h1: "SaaS launch videos, made from your website",
    answer:
      "A SaaS launch video is a short film, usually 20 to 60 seconds, that shows what your software does and why it matters, for a launch post, your landing page or a product update. With XLaunch you paste your product's URL: it reads your site, rebuilds your interface as animated motion graphics in your colours and fonts, writes the story and a voice-over, and gives you an MP4 in about 10 to 20 minutes.",
    points: [
      { title: "Your real product on screen", body: "XLaunch reads your site, screenshots and copy, then rebuilds the key screens of your app as clean motion graphics. Viewers see what the software does, not stock footage." },
      { title: "On brand without a brief", body: "Colours, fonts, logo and wording come from your own website, so the video looks like your product from the first frame." },
      { title: "Ship it with the release", body: "A new video takes about 10 to 20 minutes, and a change asked for in chat a few minutes, so every launch or feature update can have one." },
    ],
    steps: [
      { title: "Paste your SaaS's URL", body: "Add a sentence on who it's for and the feature you're launching. Attach screenshots of the screens you want shown." },
      { title: "Review the film", body: "XLaunch plans the story around what your product does, builds every scene in code and reviews its own frames before you see it." },
      { title: "Change it by chat, export", body: "Ask for any change in plain words (\"show the dashboard first\", \"shorter intro\"), then export an MP4 for your launch post or landing page." },
    ],
    prompt: "Make a launch video for https://yourproduct.com: the new reporting dashboard, for operations teams, confident and calm",
    faq: [
      { q: "How long should a SaaS launch video be?", a: "Most SaaS launch videos run 20 to 60 seconds: long enough to show the problem, the product doing the work and the result, short enough to hold attention in a feed. XLaunch makes about 30 seconds by default." },
      { q: "Can it show my actual app interface?", a: "Yes. XLaunch rebuilds your product's screens from your website and any screenshots you attach, as clean animated UI rather than a screen recording." },
      { q: "Do I need a script or a storyboard?", a: "No. XLaunch writes the story and the voice-over from your website. You can still give it direction in the prompt, such as the audience, the tone or the feature to lead with." },
      { q: "Can I use it for feature updates, not just the first launch?", a: "Yes. Describe the feature in the prompt and XLaunch builds the film around it. Each video is its own project you can keep editing by chat." },
    ],
  },
  {
    slug: "product-hunt",
    name: "Product Hunt launch videos",
    one: "a Product Hunt launch video",
    title: "Product Hunt launch video: make yours from your website",
    description:
      "Make a Product Hunt launch video from your website in minutes: story, voice-over and your product animated in your brand. Export an MP4 for your launch.",
    h1: "A Product Hunt launch video, made from your website",
    answer:
      "A Product Hunt launch video is the short film in your launch gallery and launch-day posts that shows what you made in under a minute. XLaunch makes one from your website: paste the URL, and it writes the story and a voice-over, animates your product in your colours and fonts, and exports an MP4 you can upload to Product Hunt, X and LinkedIn.",
    points: [
      { title: "Made for launch day", body: "A clear, fast film that shows what the product does in the first seconds, with captions so it works with the sound off in a feed." },
      { title: "One video, every channel", body: "Choose landscape for your Product Hunt gallery and website, or vertical for Reels, Shorts and TikTok." },
      { title: "Last-minute changes are fine", body: "Changed your tagline the night before? Ask for the change in chat and export again in minutes." },
    ],
    steps: [
      { title: "Paste your product's URL", body: "Mention it's for your Product Hunt launch and who the product is for. Add your tagline if you have one." },
      { title: "Get your film", body: "XLaunch writes the story and the voice-over, then builds and reviews every scene in your brand." },
      { title: "Polish and export", body: "Adjust anything by chat, then export the MP4 for your gallery and launch-day posts." },
    ],
    prompt: "Make a Product Hunt launch video for https://yourproduct.com, for indie makers, upbeat, end on our tagline",
    faq: [
      { q: "Does Product Hunt need a video?", a: "It isn't required, but a short video in your gallery shows what the product does faster than screenshots, and the same file works for your launch-day posts on X and LinkedIn." },
      { q: "How long should a Product Hunt video be?", a: "Keep it under a minute; 30 seconds is a good length for a gallery video and for social posts. XLaunch makes about 30 seconds by default." },
      { q: "Can I post the video on X and LinkedIn too?", a: "Yes. You own the videos you make with XLaunch and can use them anywhere. Pick vertical (9:16) when you want a version for Reels, Shorts or TikTok." },
      { q: "How quickly can I get one before launch?", a: "A new video usually takes 10 to 20 minutes, and a change asked for in chat a few minutes." },
    ],
  },
  {
    slug: "mobile-apps",
    name: "App launch videos",
    one: "an app launch video",
    title: "App launch video maker for iOS and Android apps",
    description:
      "Make a launch video for your iOS or Android app from its website and screenshots, with a voice-over. Landscape or vertical MP4s for social posts and your site.",
    h1: "App launch videos, made from your app's website",
    answer:
      "An app launch video shows your mobile app's screens in motion with a short story about what it does, for your launch posts, your website and social feeds. XLaunch makes one from your app's website and screenshots: it animates the screens in your app's style, writes a voice-over, and exports a landscape or vertical MP4.",
    points: [
      { title: "Your screens, animated", body: "Attach screenshots of your app and XLaunch builds them into the film, so people see the real flows they'll use." },
      { title: "Vertical for social", body: "Pick 9:16 for Reels, Shorts and TikTok, or 16:9 for your website and YouTube." },
      { title: "In your app's style", body: "Colours, fonts and wording come from your website and screenshots, so the video matches your app." },
    ],
    steps: [
      { title: "Paste your app's website", body: "Attach screenshots of the screens you want shown, and say who the app is for." },
      { title: "Choose the shape", body: "Landscape for your site and YouTube, vertical for Reels, Shorts and TikTok." },
      { title: "Edit by chat, export", body: "Ask for changes in plain words, then export the MP4." },
    ],
    prompt: "Make a vertical launch video for my habit-tracking app https://yourapp.com, for students, playful, show the streak screen",
    faq: [
      { q: "Can XLaunch use screenshots of my app?", a: "Yes. Attach them when you describe the video and XLaunch builds those screens into the film." },
      { q: "Can I make a vertical video for TikTok or Reels?", a: "Yes. Choose vertical (9:16) before you generate. Landscape (16:9) suits your website and YouTube." },
      { q: "Is this an App Store preview video?", a: "XLaunch makes launch and promo videos. Apple and Google have their own rules for store preview videos, such as using footage captured from the app, so check those before uploading one to a store listing." },
      { q: "Does the video have a voice-over?", a: "Yes, by default: XLaunch writes and records a narration with captions. You can switch it off before you generate or turn it down later." },
    ],
  },
  {
    slug: "developer-tools",
    name: "Developer tool launch videos",
    one: "a developer tool launch video",
    title: "Launch videos for developer tools, APIs and open source",
    description:
      "Launch videos for developer tools, APIs and open source, made from your docs: animated code and terminals in your brand. Make them from Claude Code over MCP.",
    h1: "Launch videos for developer tools",
    answer:
      "A developer tool launch video shows in under a minute what your tool, API or library does: the code you write, what happens when it runs and why it beats the old way. XLaunch makes one from your project's website or docs, animating code, terminal output and your interface in your brand, and it can be driven from Claude Code as an MCP server.",
    points: [
      { title: "Code that reads well on video", body: "Code snippets and terminal output are animated as clean, readable type, built in code rather than filmed." },
      { title: "Make it from your editor", body: "XLaunch is an MCP server: add it to Claude Code and ask Claude to make, revise and export the video without leaving your terminal." },
      { title: "From your docs or README", body: "Point it at your website or docs; it reads what your tool does and writes the story around it." },
    ],
    steps: [
      { title: "Paste your project's URL", body: "Your website or docs. Say who uses the tool and the one thing the video should make clear." },
      { title: "Get the film", body: "XLaunch writes the story, animates the code and the result, and reviews every scene." },
      { title: "Edit and export", body: "Change anything by chat, in the app or from Claude Code over MCP, then export the MP4." },
    ],
    prompt: "Make a launch video for https://yourtool.dev, a CLI for database migrations, for backend developers, show the before and after",
    faq: [
      { q: "Can it show code and terminal output?", a: "Yes. Scenes are built in code, so code snippets, commands and their output are animated as clean, readable text." },
      { q: "Can I make videos from Claude?", a: "Yes. XLaunch is an MCP server: add it to claude.ai or the Claude app as a custom connector, or to Claude Code with an API key, and Claude can create, revise and export videos for you, paid from your credits." },
      { q: "Does it work for open-source projects?", a: "Yes. Point it at the project's website or docs. The videos are yours to use on GitHub, your docs, X or Hacker News." },
      { q: "How long does a video take?", a: "Usually 10 to 20 minutes for a new video, a few minutes for a change asked for in chat." },
    ],
  },
  {
    slug: "startups",
    name: "Startup launch videos",
    one: "a startup launch video",
    title: "Startup launch video maker: a launch film from your website",
    description:
      "Make a startup launch video from your website without a studio: story, voice-over and every scene in your brand, 2D or 3D. Edit by chat, export an MP4.",
    h1: "Startup launch videos without a studio",
    answer:
      "A startup launch video explains in under a minute what you're building, who it's for and why now, for your launch, your website and investor updates. XLaunch makes one from your website: it writes the story and a voice-over, builds every scene as motion graphics or a 3D film in your brand, and lets you change anything by chat before exporting an MP4.",
    points: [
      { title: "No studio, no editor", body: "You pay in credits for what each video uses: $15 for one video with the One video pack, or a plan from $29 a month, instead of commissioning a studio." },
      { title: "2D or 3D", body: "Crisp 2D motion graphics around your product, or a short 3D film where a camera moves through your product's world." },
      { title: "Keep it current", body: "Positioning changed? Ask for the new line in chat and export again; every video stays editable." },
    ],
    steps: [
      { title: "Paste your website", body: "Say who you're for and what the video is for: a launch, your homepage or an investor update." },
      { title: "Pick 2D or 3D", body: "Motion graphics around your product, or a 3D film." },
      { title: "Edit by chat, export", body: "Refine the story and the scenes by asking, then export the MP4." },
    ],
    prompt: "Make a launch video for https://yourstartup.com, for our seed announcement, ambitious but plain-spoken",
    faq: [
      { q: "How much does a launch video cost with XLaunch?", a: "You pay in credits for what each video uses; the AI model you pick sets the price. Your first video can be $15 with the One video pack (550 credits that never expire); plans start at $29 a month. A video that fails gets its credits back, and if your first purchase isn't for you, email us within 7 days for a full refund, as long as you've used fewer than half of its credits." },
      { q: "Can I try it before paying?", a: "Yes. Free preview · no card needed: XLaunch plans your whole film and builds the voiced opening so you can see it before you buy." },
      { q: "Can I use it for an investor update or homepage?", a: "Yes. Say what the video is for in the prompt and XLaunch shapes the story around it. You own the videos and can use them anywhere." },
      { q: "What's the difference between 2D and 3D?", a: "2D videos are crisp motion graphics built around your product's interface. 3D videos are short films where every shot is built in 3D, with a camera moving through your product's world." },
    ],
  },
];
