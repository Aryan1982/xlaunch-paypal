/** Mirrors server/src/types.ts (types only). Keep in sync. */

export type Brand = {
  colors: {
    bg: string;
    surface: string;
    ink: string;
    accent: string;
    accentHi: string;
    accentTint: string;
    line: string;
    mute: string;
  };
  displayFont: string;
  uiFont: string;
  monoFont?: string;
  mode: "light" | "dark";
};

export type Asset = {
  name: string;
  kind: "logo" | "favicon" | "og" | "screenshot" | "image";
  description: string;
  width?: number;
  height?: number;
};

export type ProductProfile = {
  name: string;
  url: string;
  tagline: string;
  summary: string;
  audience: string;
  tone: string;
  features: { title: string; description: string }[];
  proofPoints: string[];
  cta: { label: string; destination: string };
  brand: Brand;
  assets: Asset[];
};

export type Scene = {
  id: string;
  title: string;
  beat: string;
  durationSec: number;
  headline: string;
  supportingText: string;
  visualDirection: string;
  /** The director's shot, in its own words (free-form films). */
  shot?: string;
  transition: string;
  assetsUsed: string[];
  narration: string;
  sfx: string;
  lines?: string[];
};

export type ScriptLine = {
  id: string;
  beat: string;
  text: string;
  shows: string;
  sceneId: string;
  start: number;
  end: number;
  /** Recorded narration take, when the line has been voiced. */
  voice?: { file: string; duration: number; fileDuration?: number };
};

export type FilmStyle = { transition: string; motion?: string };

export type Storyboard = {
  concept: string;
  visualLanguage: string;
  pacing: string;
  music: string;
  scenes: Scene[];
  script?: ScriptLine[];
  style?: FilmStyle;
  shape?: string;
};

export type Stage =
  | "created"
  | "ingesting"
  | "profile"
  | "brief"
  | "directing"
  | "storyboard"
  /** A free preview waiting to be paid for: the film planned, its first scene written. */
  | "preview"
  | "coding"
  | "verifying"
  | "ready"
  | "rendering"
  | "error";

export type SceneFile = {
  sceneId: string;
  status: "pending" | "coding" | "ready" | "error";
  durationInFrames: number;
  error?: string;
  attempts: number;
  /** The model whose code is on disk for this scene ("fallback" for the safe layout). */
  writtenBy?: string;
};

export type RenderState = {
  state: "idle" | "running" | "done" | "error";
  progress: number;
  file?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** The user stopped the last export. */
  stopped?: boolean;
};

export type AudioSettings = {
  sfx: { enabled: boolean; volume: number };
  music: { enabled: boolean; volume: number; track: string | null };
  /** Narration; older projects have none (treated as on). */
  voice?: { enabled: boolean; volume: number };
};

export type PlacedCue = { at: number; id: string; volume: number };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  kind: "prompt" | "status" | "reply";
  /** Images the user attached to this message (asset file names). */
  images?: string[];
};

/** Where a step of the film agent's work stands. "stopped": its run ended before it did. */
export type FeedStatus = "running" | "done" | "error" | "stopped";

/** What kind of work a step is, for its icon. */
export type FeedIcon = "web" | "search" | "plan" | "code" | "look" | "file" | "run";

/** A review still a stills round rendered (round "r03", file "f0120.jpg"). */
export type FeedFrame = { frame: number; seconds: number; round: string; file: string };

type FeedTask = { status: FeedStatus; end?: number; open?: number; detail?: string };

/** One entry of a film's activity feed (server pipeline/feed.ts); `run` is the agent run it belongs to. */
export type FeedItem = { id: string; at: number; run: number } & (
  | { kind: "run"; mode: "film" | "preview" | "finish" | "change"; label: string; meta?: string }
  | { kind: "thought"; text: string }
  | ({ kind: "step"; label: string; icon: FeedIcon; count?: number } & FeedTask)
  | ({ kind: "stills"; label: string; frames: FeedFrame[] } & FeedTask)
  | ({ kind: "check"; label: string } & FeedTask)
  | ({ kind: "narration"; label: string; text: string } & FeedTask)
  | { kind: "note"; text: string; level: "info" | "warn" }
  | { kind: "done"; ms: number; turns: number }
  | { kind: "error"; text: string; stopped?: boolean }
);

/** What kind of thing the product is (decides which kinds of film fit it). */
export type ProductKind = "software" | "devtool" | "service" | "consumer" | "physical" | "marketplace";

export type Brief = {
  product: string;
  kind?: ProductKind;
  audience: string;
  problem: string;
  outcome: string;
  features: string[];
  story: string;
  signature?: string;
  proof: string[];
  tone: string;
  cta: string;
  avoid: string;
  /** Open questions with the AI's best-guess answer, editable by the user (old briefs: bare strings). */
  questions: Array<BriefQuestion | string>;
  notes: string;
  confirmed?: boolean;
};

export type BriefQuestion = { q: string; answer: string };

export type Project = {
  id: string;
  /** Owner's account id (compared with Me.id). */
  userId?: string;
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  stage: Stage;
  activity: string;
  error?: string;
  options: { prompt: string; notes: string; length: number; model?: string; mode?: "2d" | "3d" | "motion"; motionRunner?: MotionRunner; film3d?: boolean; aspect?: "16:9" | "9:16"; effort?: Effort; narration?: boolean; freePreview?: boolean; replans?: number; previewScenes?: string[] };
  profile?: ProductProfile;
  brief?: Brief;
  storyboard?: Storyboard;
  /** Motion films: the agent's session and what it has made (server pipeline/motion-agent.ts). */
  motionAgent?: MotionAgent;
  scenes: SceneFile[];
  version: number;
  render: RenderState;
  audio: AudioSettings;
  cuePlan: PlacedCue[];
  chat: ChatMessage[];
  log: { at: number; level: "info" | "warn" | "error"; message: string }[];
  reasoning?: string;
  /** The current (or last) job's steps, for the chat's timer. */
  steps?: Array<{ label: string; at: number; end?: number }>;
  /** Motion films: the agent's work, step by step, for the chat's timeline. */
  feed?: FeedItem[];
  jobStartedAt?: number;
  jobEndedAt?: number;
  /** The user stopped the last job (its credits are kept). */
  stopped?: boolean;
  /** A chat change priced above the ask threshold, waiting for a yes. */
  /** `credits` is held (the most it can cost); `estimate` what it typically costs. */
  pendingChange?: { credits: number; estimate?: number; message: string; summary: string; at: number };
  /** Changes asked for while a motion film was being made, applied once it is done. */
  queuedChanges?: Array<{ text: string; references: string[] }>;
};

export type ProjectSummary = {
  id: string;
  url: string;
  title: string;
  stage: Stage;
  activity: string;
  updatedAt: number;
  createdAt: number;
  version: number;
  hasThumbnail: boolean;
  render: RenderState;
  logo: string | null;
  /** "16:9" or "9:16". */
  aspect?: "16:9" | "9:16";
  /** A free preview not paid for yet: it can't be deleted. */
  unpaidPreview: boolean;
};

/** How hard a Claude model works on a video (the server's `output_config.effort`). */
export type Effort = "low" | "medium" | "high";

/** How a motion film's agent signs in: the Claude Code login, or the Anthropic API key. */
export type MotionRunner = "claude-code" | "api";

/** What the research found on a motion film's first link. */
export type MotionFound = {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  /** Most used colours, the theme colour first. */
  colors: string[];
  fonts: string[];
  /** Downloaded images, in the film's public/context/. */
  images: string[];
};

/** A motion film's agent session and what it has made. */
export type MotionAgent = {
  runs: number;
  model?: string;
  /** PLAN.md, the agent's storyboard (its production notes). */
  plan?: string;
  summary?: string;
  found?: MotionFound;
  /** A free preview's film: built only up to here (seconds), and played only that far. */
  cut?: number;
  costUsd?: number;
};
