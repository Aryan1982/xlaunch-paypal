import { z } from "zod";

/** Composition constants shared by every generated video. */
export const COMPOSITION = {
  id: "MyVideo",
  fps: 30,
  width: 1920,
  height: 1080,
} as const;

/** The film's shape: landscape (the default) or vertical, for phones and short-form feeds. */
export type Aspect = "16:9" | "9:16";
export const ASPECTS: readonly Aspect[] = ["16:9", "9:16"];

/** Frame size in px for an aspect (older projects have none: landscape). */
export const frameOf = (aspect?: Aspect): { width: number; height: number } =>
  aspect === "9:16" ? { width: COMPOSITION.height, height: COMPOSITION.width } : { width: COMPOSITION.width, height: COMPOSITION.height };

export const BrandSchema = z.object({
  /** Role-based palette, hex strings. */
  colors: z.object({
    bg: z.string(),
    surface: z.string(),
    ink: z.string(),
    accent: z.string(),
    accentHi: z.string(),
    accentTint: z.string(),
    line: z.string(),
    mute: z.string(),
  }),
  /** Google font family names (must exist in @remotion/google-fonts). */
  displayFont: z.string(),
  uiFont: z.string(),
  monoFont: z.string().optional(),
  mode: z.enum(["light", "dark"]).default("light"),
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * What the product's interface looks like, read from its screenshots: scenes
 * rebuild THIS product's UI, so two products never share one window.
 */
export const UiSchema = z.object({
  /** Whether this reading comes from the product's app itself (not a marketing page). */
  isApp: z.boolean().default(false),
  nav: z.enum(["top", "side", "none"]).catch("side"),
  theme: z.enum(["light", "dark"]).catch("light"),
  density: z.enum(["compact", "comfortable", "airy"]).catch("comfortable"),
  corners: z.enum(["sharp", "soft", "round"]).catch("soft"),
  surfaces: z.enum(["flat", "cards", "bordered"]).catch("bordered"),
  /** The product's distinctive UI elements ("command bar", "kanban board", "canvas", "split preview"). */
  signature: z.array(z.string()).catch([]),
});
export type Ui = z.infer<typeof UiSchema>;

export const AssetSchema = z.object({
  /** File name inside the project's assets folder, used by `asset("name")`. */
  name: z.string(),
  kind: z.enum(["logo", "favicon", "og", "screenshot", "image"]),
  description: z.string().default(""),
  /** Screenshots: a detailed reading of the UI (layout, colours, components, copy) used as design reference. */
  reference: z.string().optional(),
  /** Screenshots: the UI's fingerprint as the vision model read it (see UiSchema). */
  ui: z.lazy(() => UiSchema).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** Text that a model sometimes answers as a list ("tone": ["calm", "warm"]): joined, not rejected. */
const text = z.preprocess((v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : v), z.string());

export const ProductProfileSchema = z.object({
  name: z.string(),
  url: z.string(),
  tagline: text,
  summary: text,
  audience: text,
  tone: text,
  features: z
    .array(z.object({ title: z.string(), description: z.string() }))
    .min(1)
    .max(8),
  proofPoints: z.array(z.string()).default([]),
  cta: z.object({ label: z.string(), destination: z.string() }),
  brand: BrandSchema,
  assets: z.array(AssetSchema).default([]),
  /** The product's UI fingerprint, combined from its screenshots (prefers readings of the app itself). */
  ui: UiSchema.optional(),
  /** Text from the site's inner pages (features, pricing, about, customers, docs), attached by the crawler. */
  pages: z.array(z.object({ url: z.string(), title: z.string().default(""), text: z.string() })).optional(),
  /** What the ingest had to work around, said to the user (a font substituted, no app screens found). */
  notes: z.array(z.string()).optional(),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

/** Scene ids (`s1`, `s2`, ...) of the retired scene studio's storyboards. */
export const SCENE_ID = /^s\d{1,3}$/;

export const SceneSchema = z.object({
  id: z.string().regex(SCENE_ID, "must be a scene id like s1"),
  title: z.string(),
  /** Beat in the story arc, free text. */
  beat: z.string(),
  /** What the viewer understands or feels by the end of this scene: its job in the story. */
  storyPoint: z.string().default(""),
  /** How the frame is laid out: see COMPOSITIONS in the director prompt. */
  composition: z.string().default(""),
  /** The one thing the viewer must read, which the camera pushes in on. */
  keyDetail: z.string().default(""),
  durationSec: z.number().min(1).max(10),
  headline: z.string(),
  supportingText: z.string().default(""),
  /** What moves and how, in plain language: shown in the storyboard, and the brief the coder builds from. */
  visualDirection: z.string().default(""),
  /** Free mode: the art director's shot for this scene, planned with the whole film in view (wins over visualDirection). */
  shot: z.string().default(""),
  /** Ids of the narration lines said over this scene (see Storyboard.script). */
  lines: z.array(z.string()).default([]),
  /** How this scene hands off to the next one. */
  transition: z.string().default(""),
  assetsUsed: z.array(z.string()).default([]),
  /** Reserved for the audio phase. */
  narration: z.string().default(""),
  sfx: z.string().default(""),
});
export type Scene = z.infer<typeof SceneSchema>;

/** One line of the narration script, timed on the whole-film timeline once scenes exist. */
export const ScriptLineSchema = z.object({
  id: z.string(),
  beat: z.string().default(""),
  /** What the narrator says. Shown as captions; voiced later. */
  text: z.string(),
  /** What the picture must show while the line is said. */
  shows: z.string().default(""),
  /** Recorded narration for this line (pipeline/voice.ts): asset file, length and word timings. */
  voice: z
    .object({
      file: z.string(),
      /** Where this line starts inside the take (seconds): the script is one take, each line plays its slice. */
      offset: z.number().optional(),
      duration: z.number(),
      /** Length of the audio file (speech plus its natural tail); playback uses it so nothing is clipped. */
      fileDuration: z.number().optional(),
      words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).default([]),
    })
    .optional(),
  /** Scene that carries the line (set by the director). */
  sceneId: z.string().default(""),
  /** Seconds on the film timeline. */
  start: z.number().default(0),
  end: z.number().default(0),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export const StoryboardSchema = z.object({
  concept: z.string(),
  /** The film's story in a few sentences: who, what is wrong, the turn, the resolution. */
  story: z.string().default(""),
  /** The one visual element that carries the story through every scene. */
  throughline: z.string().default(""),
  /** Exact string that appears in the props of several scenes, so one concrete thing is followed through the film. */
  throughlineText: z.string().default(""),
  visualLanguage: z.string(),
  pacing: z.string(),
  music: z.string().default(""),
  scenes: z.array(SceneSchema).min(2).max(10),
  /** The film's design guide: palette, type, surfaces, motifs and motion every scene follows. */
  design: z.string().default(""),
  /** The story shape the writer chose, in a few words. */
  shape: z.string().default(""),
  /** The product's main screen, one design every UI scene reuses (continuity between scenes). */
  screen: z.string().default(""),
  /** The product's UI fingerprint: read from its screenshots, or designed by the writer from what the product does. */
  ui: UiSchema.optional(),
  /** Seed for the film's cut plan (the retired scene studio's). */
  cutSeed: z.string().default(""),
  /** A hand-made cut plan (one kind per cut, e.g. "hard", "black"); overrides the seeded plan. */
  cutPlan: z.array(z.string()).optional(),
  /** Narration script, hook to CTA; drives scene lengths and the captions. */
  script: z.array(ScriptLineSchema).default([]),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** What the film is about, confirmed (and possibly edited) by the user before any script is written. */
/** What kind of thing the product is: decides which film formats fit (src/library/formats.ts). */
export const PRODUCT_KINDS = ["software", "devtool", "service", "consumer", "physical", "marketplace"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const BriefSchema = z.object({
  product: z.string().default(""),
  /** software app | developer tool | service/agency/studio | consumer app | physical product | marketplace. */
  kind: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase().trim() : v), z.enum(PRODUCT_KINDS).optional().catch(undefined)),
  audience: text.default(""),
  problem: z.string().default(""),
  outcome: z.string().default(""),
  features: z.array(z.string()).default([]),
  story: z.string().default(""),
  /** The one interaction that shows the product's magic (what the film must show working). */
  signature: z.string().default(""),
  proof: z.array(z.string()).default([]),
  tone: text.default(""),
  cta: z.string().default(""),
  avoid: z.string().default(""),
  /** Open questions with the model's best-guess answer, which the user edits. Old briefs stored bare strings. */
  questions: z
    .array(z.union([z.string().transform((q) => ({ q, answer: "" })), z.object({ q: z.string(), answer: z.string().default("") })]))
    .default([]),
  /** Extra direction from the user. */
  notes: z.string().default(""),
});
export type Brief = z.infer<typeof BriefSchema> & { confirmed?: boolean };

export type Stage =
  | "created"
  | "ingesting"
  | "profile"
  | "brief"
  | "directing"
  | "storyboard"
  /** A free preview: the whole film planned, its opening built, waiting for the user to pay to finish it. */
  | "preview"
  | "coding"
  | "verifying"
  | "ready"
  | "rendering"
  | "error";

export type SceneStatus = "pending" | "coding" | "ready" | "error";

export type SceneFile = {
  sceneId: string;
  status: SceneStatus;
  /** Frames, derived from durationSec at generation time. */
  durationInFrames: number;
  error?: string;
  attempts: number;
  /** The model whose code is on disk for this scene ("fallback" for the safe layout), so a film's quality can be attributed. */
  writtenBy?: string;
};

export type RenderState = {
  state: "idle" | "running" | "done" | "error";
  progress: number;
  file?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** R2 key of the exported MP4, so a download survives a restart or a new server. */
  stored?: string;
  /** The user stopped the last export (back to idle). */
  stopped?: boolean;
};

export type LogEntry = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type AudioSettings = {
  sfx: { enabled: boolean; volume: number };
  music: { enabled: boolean; volume: number; track: string | null };
  /** Narration (ElevenLabs takes per script line); older projects have none. */
  voice?: { enabled: boolean; volume: number };
  /** A hand-made sound design on the film timeline (seconds); `replace` drops the templates' own cues. */
  design?: { replace?: boolean; cues: Array<{ at: number; id: string; volume?: number }> };
};

export const DEFAULT_AUDIO: AudioSettings = {
  sfx: { enabled: true, volume: 0.6 },
  music: { enabled: true, volume: 0.35, track: null },
  voice: { enabled: true, volume: 1 },
};

/** A sound effect placed on the whole-video timeline (seconds). */
export type PlacedCue = { at: number; id: string; volume: number };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** "status" lines are pipeline milestones; "reply" are answers to the user. */
  kind: "prompt" | "status" | "reply";
  /** Images the user attached to this message (asset file names), shown under it. */
  images?: string[];
};

/** Where a step of the film agent's work stands. "stopped": its run ended before it did. */
export type FeedStatus = "running" | "done" | "error" | "stopped";

/** What kind of work a step is, for its icon. */
export type FeedIcon = "web" | "search" | "plan" | "code" | "look" | "file" | "run";

/** One review still a stills round rendered: review/<round>/<file> in the film's workspace (round "r03", file "f0120.jpg"). */
export type FeedFrame = { frame: number; seconds: number; round: string; file: string };

/** A step that runs: its tool calls still open, when it ended, and a line under it (what it found, or its error). */
type FeedTask = { status: FeedStatus; end?: number; open?: number; detail?: string };

/**
 * One entry of a film's activity feed (pipeline/feed.ts): what its agent did,
 * in order, shown in the chat as a timeline under the request that started it.
 * `run` is the agent run it belongs to (MotionAgent.runs at the time).
 */
export type FeedItem = { id: string; at: number; run: number } & (
  | { kind: "run"; mode: "film" | "preview" | "finish" | "change"; label: string; meta?: string }
  | { kind: "thought"; text: string }
  | ({ kind: "step"; label: string; icon: FeedIcon; count?: number } & FeedTask)
  | ({ kind: "stills"; label: string; frames: FeedFrame[] } & FeedTask)
  | ({ kind: "check"; label: string } & FeedTask)
  | ({ kind: "narration"; label: string; text: string } & FeedTask)
  | { kind: "note"; text: string; level: "info" | "warn" }
  /** The run's work is done (its film passed the check): how long it took and the agent's turns. */
  | { kind: "done"; ms: number; turns: number }
  | { kind: "error"; text: string; stopped?: boolean }
);

export const FILM_MODES = ["2d", "3d", "motion"] as const;
export type FilmMode = (typeof FILM_MODES)[number];

export type ProjectOptions = {
  /** The user's original prompt, verbatim. */
  prompt: string;
  notes: string;
  /** Target length in seconds (a motion film: config.motion.seconds; it may run up to 5 s longer for its ending to settle). */
  length: number;
  /** Exact number of scenes; unset lets the writer decide. */
  scenes?: number;
  /** The model the user picked for this project (one of OFFERED_MODELS; older projects may hold another, still resolved). */
  model?: string;
  /** Reference images the user attached (asset file names), read ahead of the site's screenshots. */
  references?: string[];
  /**
   * "motion": a film a Claude agent makes in its own Remotion workspace (pipeline/motion-agent.ts), every new film.
   * "2d"/"3d" (or unset): a film from the retired scene studio, kept readable only (lib/retired.ts).
   */
  mode?: FilmMode;
  /** Motion films: how the agent signs in, the Claude Code login or the Anthropic API (config.motion.runner when unset). */
  motionRunner?: MotionRunner;
  /** Motion films: the agent keeps its shell (an admin's film). Anyone else's has only its file tools and the studio's check and stills tools. */
  motionShell?: boolean;
  /** Motion films: a 3D film (low-poly three.js worlds, the 3D tab): its own skill, and priced as more work. */
  film3d?: boolean;
  /** Whether the video is narrated (priced per 30 s); older projects: whatever the scene mode does. */
  narration?: boolean;
  /** "16:9" landscape (the default) or "9:16" vertical. */
  aspect?: Aspect;
  /** How hard a Claude 5.x model works on this project's calls (`output_config.effort`); unset: CLAUDE_EFFORT. */
  effort?: Effort;
  /** Started as the account's free preview: the whole film planned and its opening built, unpaid until finished. */
  freePreview?: boolean;
  /** Free re-plans used on a preview ("Try another plan"). */
  replans?: number;
  /** The scenes a free preview animated (the opening ones, up to the first that shows the product), kept once it is paid for. */
  previewScenes?: string[];
};

/** The effort levels the user can pick for Claude 5.x models. */
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** How a motion film's agent signs in: the Claude Code login, or the Anthropic API key. Same session, tools and prompts. */
export const MOTION_RUNNERS = ["claude-code", "api"] as const;
export type MotionRunner = (typeof MOTION_RUNNERS)[number];

/** What the research found on the film's first link (pipeline/motion-context.ts), shown while the film is made. */
export type MotionFound = {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  /** Most used colours, the theme colour first. */
  colors: string[];
  fonts: string[];
  /** Downloaded images, in the workspace's public/context/. */
  images: string[];
};

/** A motion film's agent session and what it has made (pipeline/motion-agent.ts). */
export type MotionAgent = {
  /** The Claude session, resumed for change requests. */
  sessionId?: string;
  /** The model the session reported. */
  model?: string;
  /** Runs so far (the first film, then one per change request). */
  runs: number;
  /** PLAN.md, the agent's storyboard (its production notes). */
  plan?: string;
  /** The latest round of review frames (paths in the workspace). */
  frames: string[];
  /** The agent's closing summary. */
  summary?: string;
  /** What the research found, for the studio to show while the film is made. */
  found?: MotionFound;
  /** A free preview's published film: built only up to here (seconds), and played only that far. Cleared once the film is finished. */
  cut?: number;
  /** Cumulative estimated session cost (USD), as the agent reports it. */
  costUsd?: number;
  /** Token totals already billed per model for this session (the session's totals are cumulative). */
  billed?: { sessionId: string; byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> };
};

export type Project = {
  id: string;
  /** Owner (Supabase auth user id); "local" when running without accounts. */
  userId?: string;
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  stage: Stage;
  /** Human readable description of what the pipeline is doing now. */
  activity: string;
  error?: string;
  options: ProjectOptions;
  profile?: ProductProfile;
  /** The product brief; the script is written only once the user confirms it. */
  brief?: Brief;
  storyboard?: Storyboard;
  /** Motion films: the agent's session and its output. */
  motionAgent?: MotionAgent;
  scenes: SceneFile[];
  /** Bumped every time the video source changes, so clients know to reload. */
  version: number;
  render: RenderState;
  /**
   * The credits this video cost (billing on). Held until the video is first
   * ready (then delivered: no longer refundable) and refunded if it fails
   * before that; a retry of a refunded video charges again. Absent on free
   * projects.
   */
  /**
   * The video's charge. `credits` is what was held (the most it can cost);
   * `usd` the model cost metered so far across its jobs; `charged` what it
   * came to once settled (the rest of the hold went back).
   */
  charge?: { ref: string; credits: number; state: "held" | "delivered" | "refunded" | "spent"; estimate?: number; usd?: number; charged?: number };
  /** The user stopped the last job: its credits are kept ("spent"), not refunded. */
  stopped?: boolean;
  /** When its owner deleted it (ms): gone from their side, kept with its files for admins. */
  deletedAt?: number;
  /** A public link its owner made (/s/<token>): anyone with it can watch the film, signed in or not (share.ts). */
  share?: { token: string; createdAt: number };
  /**
   * A chat change estimated above CHAT_ASK_ABOVE, waiting for the user to
   * confirm. Actions are kept as planned and validated again when confirmed.
   */
  pendingChange?: { actions: unknown[]; credits: number; estimate?: number; message: string; summary: string; at: number };
  /** Changes asked for while a motion film was being made, applied as one change request once it is done. */
  queuedChanges?: Array<{ text: string; references: string[] }>;
  audio: AudioSettings;
  /** Where sound effects land on the final timeline; refreshed whenever the project is rebuilt. */
  cuePlan: PlacedCue[];
  chat: ChatMessage[];
  log: LogEntry[];
  /** The model's thinking from the last LLM step, for the UI drawer. */
  reasoning?: string;
  /** The current (or last) job's steps with their start and end times, for the chat's timer. */
  steps?: Array<{ label: string; at: number; end?: number }>;
  /** Motion films: the agent's work, step by step, for the chat's timeline (pipeline/feed.ts; the newest FEED_CAP kept). */
  feed?: FeedItem[];
  /** When the current (or last) job started and ended. */
  jobStartedAt?: number;
  jobEndedAt?: number;
};
