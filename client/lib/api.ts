import type { Costs } from "./pricing";
import type { Effort, MotionRunner, Project, ProjectSummary } from "./types";

export class ApiError extends Error {
  readonly status: number;
  /** "signin" | "quota" | "credits" | "has_plan" when the server says why. */
  readonly code?: string;
  /** Anything else the server said about it (e.g. `previewProjectId`). */
  readonly details: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A model on offer (Sonnet 5.5, Opus 5.5); `chooseEffort`: its effort may be picked (Opus), else it always works at high. */
export type ModelOption = { id: string; label: string; chooseEffort?: boolean };

/** GET /models: the models on offer, the default, the free preview's model, and the default effort for a model that takes one. */
export type Models = { models: ModelOption[]; default: string; preview?: ModelOption; effort?: string };

export type Me = {
  /** The account id: matches Project.userId on the owner's projects. */
  id: string;
  email: string;
  plan: string;
  isAdmin: boolean;
  /** May pick how the film agent signs in (subscription or API): an admin, or an account on MOTION_SUBSCRIPTION_ACCOUNTS. */
  chooseRunner?: boolean;
  /** May pick the model and effort, even for a free preview: an admin, or an account on MOTION_MODEL_PICKER_ACCOUNTS. */
  chooseModel?: boolean;
  /** May make 3D videos (open to all, or an admin while 3D is tested). */
  threeD: boolean;
  /** Hasn't bought anything yet: a free preview, in 2D, made with the preview's own model at high effort. */
  free?: boolean;
  limits: { videos: number; tokens: number; storageMb: number };
  usage: { videos: number; tokens: number; costUsd: number; storedBytes: number } | null;
};

export type BillingProduct = (
  | { kind: "subscription"; sku: string; name: string; tier: "launch" | "studio" | "scale"; interval: "month" | "year"; priceCents: number; credits: number }
  | { kind: "pack"; sku: string; name: string; priceCents: number; credits: number }
) & {
  /** The regular price, shown struck through while launch pricing lasts. */
  regularPriceCents?: number;
};

/** A checkout's outcome: paid (and whether its credits are on the balance), still going, or failed. */
export type CheckoutStatus = { state: "paid" | "pending" | "failed"; credited: boolean; sku: string | null; balance: number };

/** Launch pricing: on until `endsAt` (an ISO date, inclusive). */
export type Offer = { name: string; endsAt: string };

/** One change on the account's credits (GET /billing/activity), newest first. */
export type CreditActivity = {
  id: number;
  at: string;
  kind: "purchase" | "spend" | "refund" | "adjust";
  /** Signed: + added, - taken. */
  credits: number;
  /** The balance right after this change. */
  balance: number;
  description: string;
  projectId: string | null;
  projectTitle: string | null;
  paypalOrderId: string | null;
};

export type Billing = {
  /** Off: no payments yet, the monthly quotas are the limit. */
  enabled: boolean;
  /** PayPal: "sandbox" takes no real money. */
  environment: "sandbox" | "live" | null;
  /** Public: the PayPal JS SDK loads with it (the server's PayPal app, so its orders and these buttons match). */
  paypalClientId?: string;
  balance: { sub: number; pack: number; total: number };
  products: BillingProduct[];
  offer?: Offer | null;
  /** Typical costs per model (work is metered: charged what it actually uses). */
  costs: Costs;
};

/** The video's shape: landscape or vertical. */
export type Aspect = "16:9" | "9:16";

/** An example video on the home page. */
export type ShowcaseItem = { id: string; title: string; mode: "2d" | "3d"; width: number; height: number; seconds: number; version: number; uploadedAt: string };

export type ShowcasePage = { items: ShowcaseItem[]; total: number; hasMore: boolean };

export const showcaseVideoUrl = (item: ShowcaseItem) => `/api/showcase/${encodeURIComponent(item.id)}.mp4?v=${item.version}`;
export const showcasePosterUrl = (item: ShowcaseItem) => `/api/showcase/${encodeURIComponent(item.id)}.jpg?v=${item.version}`;

export type ApiKeyInfo ={ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

/** Signed out: go to sign-in ("expired" for the funnel, lib/funnel.ts SIGNIN_SOURCES), and come back here after. */
const redirectFor = (status: number): void => {
  if (typeof window === "undefined") return;
  const here = window.location.pathname;
  if (status === 401 && here !== "/login") {
    window.location.assign(`/login?from=expired&next=${encodeURIComponent(here + window.location.search)}`);
  }
};

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let code: string | undefined;
    let details: Record<string, unknown> = {};
    try {
      const body = (await response.json()) as { error?: string; code?: string } & Record<string, unknown>;
      if (body.error) message = body.error;
      code = body.code;
      details = body;
    } catch {
      // keep the status text
    }
    redirectFor(response.status);
    throw new ApiError(message, response.status, code, details);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** A reference image attached to a prompt (base64 data URL). */
export type ReferenceImage = { type: "image/jpeg" | "image/png" | "image/webp"; data: string };

export const api = {
  me: () => request<Me>("/me"),
  billing: () => request<Billing>("/billing"),
  /** The public price list (no sign-in): typical costs per model, and what's for sale. */
  pricing: () => request<{ costs: Costs; products: BillingProduct[] }>("/pricing"),
  /** A PayPal order for one credit pack: `url` is PayPal's approval page (send the browser there), `orderId` is for the PayPal buttons. `projectId`: the free preview waiting for it, which the browser goes back to (and finishes) after paying, with the `model` picked on the paywall. */
  checkout: (sku: string, projectId?: string, model?: string) =>
    post<{ url: string; orderId: string }>("/billing/checkout", { sku, ...(projectId ? { projectId } : {}), ...(projectId && model ? { model } : {}) }),
  /** Pay for a free preview and build the rest of the film (the model may change first). */
  buildPreview: (id: string, choice: { model?: string; effort?: Effort } = {}) => post<{ ok: true }>(`/projects/${id}/build`, choice),
  /** What a PayPal order really came to: an approved one is captured and credited by the server. */
  checkoutStatus: (orderId: string) => request<CheckoutStatus>(`/billing/checkout-status?${new URLSearchParams({ order_id: orderId })}`),
  /** Every purchase, charge and refund on the account, newest first (up to 500). */
  activity: () => request<{ items: CreditActivity[] }>("/billing/activity").then((r) => r.items),
  /** All examples chosen for a place (both styles), in the order set in the CMS. */
  showcase: (place: "home" | "login" = "home") => request<ShowcasePage>(`/showcase?place=${place}`).then((r) => r.items),
  /** One page of examples in a style, newest first. */
  showcasePage: (mode: "2d" | "3d", offset: number, limit: number) =>
    request<ShowcasePage>(`/showcase?mode=${mode}&offset=${offset}&limit=${limit}`),
  apiKeys: () =>request<{ keys: ApiKeyInfo[] }>("/keys").then((r) => r.keys),
  /** The returned `key` is shown this once; the server keeps only its hash. */
  createApiKey: (name: string) => post<ApiKeyInfo & { key: string }>("/keys", { name }),
  revokeApiKey: (id: string) => request<void>(`/keys/${id}`, { method: "DELETE" }),
  /** One page of the caller's projects, newest first. */
  listProjects: (offset = 0, limit = 12) =>
    request<{ projects: ProjectSummary[]; hasMore: boolean }>(`/projects?offset=${offset}&limit=${limit}`),
  /** The models on offer, for 2D and 3D films alike. */
  models: () => request<Models>("/models"),
  /** Free previews left today (UTC) across everyone (public). */
  previews: () => request<{ left: number; perDay: number }>("/previews"),
  createProject: (prompt: string, model?: string, references: ReferenceImage[] = [], mode: "2d" | "3d" = "2d", aspect: Aspect = "16:9", effort?: Effort, narration = false, runner?: MotionRunner) =>
    post<Project>("/projects", { prompt, mode, aspect, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(narration ? { narration } : {}), ...(references.length ? { references } : {}), ...(runner ? { runner } : {}) }),
  /** Go ahead with the change waiting for confirmation (project.pendingChange). */
  confirmChange: (id: string) => post<{ ok: true }>(`/projects/${id}/chat/confirm`),
  cancelChange: (id: string) => post<{ ok: true }>(`/projects/${id}/chat/cancel`),
  chat: (id: string, message: string, model?: string, references: ReferenceImage[] = [], effort?: Effort, narration?: boolean) =>
    post(`/projects/${id}/chat`, { message, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(narration !== undefined ? { narration } : {}), ...(references.length ? { references } : {}) }),
  retry: (id: string) => post(`/projects/${id}/retry`),
  /** Stop the running job; what it was charged is kept. */
  stop: (id: string) => post<{ ok: true }>(`/projects/${id}/stop`),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  render: (id: string) => post(`/projects/${id}/render`),
  source: (id: string) => request<FilmSource>(`/projects/${id}/source`),
  /** The project's public link token (the one it has, or a new one): the film plays at /s/<token>, signed in or not. */
  shareProject: (id: string) => post<{ token: string }>(`/projects/${id}/share`).then((r) => r.token),
  /** Turn the project's public link off. */
  unshareProject: (id: string) => request<void>(`/projects/${id}/share`, { method: "DELETE" }),
  /** A film's source, opened by its share link (no sign-in). */
  sharedSource: (token: string) => request<FilmSource>(`/share/${encodeURIComponent(token)}/source`),
  motionShowcase: () => request<{ items: MotionShowcaseItem[] }>("/showcase-motion").then((r) => r.items),
};

/** A film's source for the preview frame (lib/preview-bridge.ts). */
export type FilmSource = { version: number; compositionId: string; files: Record<string, string>; entryPoint?: string; staticFiles?: Array<{ name: string; src: string }> };

/** What a share link shows (server: share.ts): enough to play the film, nothing private. */
export type PublicShare = {
  title: string;
  host: string;
  aspect: Aspect;
  seconds: number;
  version: number;
  ready: boolean;
  /** A free preview: where it stops (seconds). Null once the film is paid for. */
  preview: { cut: number } | null;
};

export const assetUrl = (id: string, name: string) =>
  `/api/projects/${id}/assets/${encodeURIComponent(name)}`;
export const thumbnailUrl = (id: string, v: number) => `/api/projects/${id}/thumbnail.jpg?v=${v}`;
export const downloadUrl = (id: string) => `/api/projects/${id}/download`;
/** A file in a motion film's workspace public/ (e.g. the research images in context/). */
export const motionPublicUrl = (id: string, name: string) => `/api/projects/${id}/motion/public/${name.split("/").map(encodeURIComponent).join("/")}`;
/** A review still a motion film's agent rendered (its owner only). */
export const reviewFrameUrl = (id: string, frame: { round: string; file: string }) => `/api/projects/${id}/motion/review/${encodeURIComponent(frame.round)}/${encodeURIComponent(frame.file)}`;

/** A motion film made with XLaunch, shown while one is being made. */
export type MotionShowcaseItem = { id: string; title: string; note: string; seconds: number; aspect: "16:9" | "9:16" | "1:1" };
export const motionShowcaseUrl = (item: MotionShowcaseItem, kind: "mp4" | "jpg") => `/api/showcase-motion/${item.id}.${kind}`;
