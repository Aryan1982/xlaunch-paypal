import { Readable } from "stream";
import type express from "express";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { isApiKey, ownerOfKey } from "./apikeys";
import { verifyToken } from "./auth";
import { config } from "./config";
import { dbEnabled, supabaseUrl } from "./db";

/**
 * XLaunch as an MCP server (Streamable HTTP, stateless) at /api/mcp, for Claude (claude.ai,
 * Desktop, mobile, Claude Code) and other MCP clients. Two ways to sign in:
 *
 * - OAuth, for claude.ai and any client that adds the server by URL: a missing token gets a 401
 *   pointing at the protected resource metadata (below), which names Supabase Auth's OAuth 2.1
 *   server; the user signs in to XLaunch and approves on /oauth/consent, and the client sends
 *   Supabase's access token.
 * - An API key, for clients that take a header:
 *     claude mcp add --transport http xlaunch https://xlaunch.pro/api/mcp \
 *       --header "Authorization: Bearer xl_..."
 *
 * Each tool calls this server's own REST API with the caller's token, so every rule there
 * (ownership, credits and refunds, capacity, rate limits) applies unchanged and nothing is
 * implemented twice.
 */

/** Where an MCP client finds how to sign in (RFC 9728), served by mountMcp and reached through the web app's origin. */
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

export type RestResult = { status: number; body: unknown };
export type Rest = (method: "GET" | "POST", path: string, body?: unknown) => Promise<RestResult>;

const restFor = (token: string | undefined): Rest => async (method, path, body) => {
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const response = await fetch(`http://${host}:${config.port}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text
  }
  return { status: response.status, body: parsed };
};

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown, hint?: string): ToolResult => ({
  content: [{ type: "text", text: `${JSON.stringify(data, null, 2)}${hint ? `\n\n${hint}` : ""}` }],
});

/** The API's error, made readable for the model and the user it is helping. */
const fail = (r: RestResult): ToolResult => {
  const body = (r.body ?? {}) as { error?: string; code?: string; needed?: number; balance?: number };
  const message = typeof body.error === "string" ? body.error : `Request failed (${r.status}).`;
  const extra =
    body.code === "credits"
      ? ` Call buy_credits for a checkout link to give the user, or they can buy credits at ${config.appOrigin}/billing.`
      : body.code === "busy"
        ? " Another job is still running for this account; wait for it to finish, then try again."
        : "";
  return { content: [{ type: "text", text: `${message}${extra}` }], isError: true };
};

const ProjectId = z.string().min(1).max(64).describe("The video's projectId, as returned by create_video or list_videos.");

type Project = {
  id: string;
  title?: string;
  url?: string;
  stage: string;
  activity?: string;
  error?: string;
  version?: number;
  scenes?: unknown[];
  render?: { state: string; progress?: number; error?: string; stopped?: boolean };
  stopped?: boolean;
  charge?: { credits: number; state: string; charged?: number; estimate?: number };
  pendingChange?: { credits: number; summary: string; estimate?: number };
  chat?: Array<{ role: string; text: string; kind?: string }>;
  options?: { aspect?: string };
};

const nextStep = (p: Project): string => {
  if (p.stage === "error" && p.stopped) {
    return "Stopped on request; it was charged for what it used so far. The user can run it again from the web app (charged again), or call create_video for a new one.";
  }
  if (p.stage === "error") return "This video failed. Its credits were refunded. You can try again with create_video.";
  if (p.stage === "brief") return "The video is waiting for its brief to be confirmed: call confirm_brief.";
  // an account with no credits gets its one free preview: it stops here until the user pays, so polling won't change it
  if (p.stage === "preview") {
    return `This is the account's free preview (it has no credits): the whole film is planned and its opening is built. The user can watch it at ${config.appOrigin}/p/${p.id}. To finish the full video, call buy_credits with this project_id and give the user the checkout link; once check_purchase says it's paid, call finish_preview. It won't change until then, so stop polling.`;
  }
  if (p.stage !== "ready") return "Still working. Check again in about 60 seconds (not sooner).";
  if (p.pendingChange) {
    return `A requested change ${p.pendingChange.summary}: about ${p.pendingChange.estimate ?? p.pendingChange.credits} credits, at most ${p.pendingChange.credits} (charged for what it uses). Ask the user, then call confirm_revision with confirm true or false.`;
  }
  if (p.render?.state === "running") return "Exporting. Check again in about 30 seconds.";
  if (p.render?.state === "done") return "Exported. Call get_download_url for a link to the MP4.";
  if (p.render?.state === "error") return "The export failed. Call export_video to try again.";
  if (p.render?.stopped) return "The export was stopped. Call export_video to start it again.";
  return "The video is ready. Call export_video to render the MP4, or revise_video to change something first.";
};

const summary = (p: Project) => ({
  projectId: p.id,
  title: p.title,
  website: p.url,
  stage: p.stage,
  activity: p.activity,
  error: p.error,
  scenes: p.scenes?.length ?? 0,
  aspect: p.options?.aspect ?? "16:9",
  version: p.version,
  export: p.render ? { state: p.render.state, progress: p.render.progress, error: p.render.error } : undefined,
  // held while the video is made; settled to what it used once delivered
  credits: p.charge ? { held: p.charge.credits, charged: p.charge.charged, estimate: p.charge.estimate, state: p.charge.state } : undefined,
  waitingForConfirmation: p.pendingChange ? { change: p.pendingChange.summary, estimate: p.pendingChange.estimate, atMost: p.pendingChange.credits } : undefined,
  // the studio's latest reply: what a revision did, what it cost, or why it couldn't
  lastMessage: p.chat?.filter((m) => m.role === "assistant").at(-1)?.text,
});

/** The REST bodies the purchase tools read. */
const BillingBody = z.object({
  enabled: z.boolean(),
  balance: z.object({ total: z.number() }),
  costs: z.unknown(),
  products: z.array(z.object({ kind: z.string(), sku: z.string(), name: z.string(), priceCents: z.number(), credits: z.number() })).default([]),
});
const CheckoutBody = z.object({ url: z.string(), orderId: z.string().optional() });
const StatusBody = z.object({ state: z.enum(["paid", "pending", "failed"]), credited: z.boolean(), sku: z.string().nullable(), balance: z.number() });
const ErrorBody = z.object({ error: z.string() });

/** The tools, against one caller's REST access. Exported for tests. */
export const buildServer = (rest: Rest): McpServer => {
  const server = new McpServer({ name: "xlaunch", version: "1.0.0" });

  server.registerTool(
    "create_video",
    {
      title: "Create a launch video",
      description:
        "Make an animated 2D launch video (motion graphics) for a product from its website. Put the product's URL (https://...) in the prompt, " +
        `with anything about tone, audience or message. Every video is about ${config.motion.seconds} seconds long. Generation takes 10-20 minutes: this returns at once with a projectId. ` +
        "Then call get_video_status about once a minute (not more often) until the stage is \"ready\", then export_video, then get_download_url. " +
        "Costs credits, metered: the typical cost per model is in get_credits; an estimate is held and only what the video uses is charged. A video that fails is refunded automatically. " +
        "Videos made here are always 2D; 3D films are made in the XLaunch web app. " +
        "Narration is on by default: a voice-over with captions that the scenes follow (it adds a few credits; narration: false turns it off). " +
        "model picks the AI model by id (the ids and their typical costs are in get_credits); it sets the price. " +
        "aspect \"9:16\" makes a vertical video for phones (Reels, Shorts, TikTok); the default is 16:9 landscape.",
      inputSchema: z.object({
        prompt: z.string().min(3).max(1200).describe("What the video is about, including the product's https:// URL."),
        scenes: z.number().int().min(1).max(10).optional().describe("Number of scenes, if you want to fix it. The film agent chooses its own scenes and ignores this."),
        aspect: z.enum(["16:9", "9:16"]).optional().describe("\"16:9\" landscape (default) or \"9:16\" vertical for phones."),
        narration: z.boolean().default(true).describe("A voice-over with captions that tells the story (default true)."),
        model: z.string().max(80).optional().describe("The AI model's id, from get_credits (default: the server's default model)."),
      }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, scenes, aspect, narration, model }) => {
      // MCP makes 2D videos only; 3D stays in the web app
      const r = await rest("POST", "/projects", { prompt, narration, mode: "2d", ...(model ? { model } : {}), ...(scenes ? { scenes } : {}), ...(aspect ? { aspect } : {}) });
      if (r.status !== 201) return fail(r);
      const p = r.body as Project;
      return ok({ ...summary(p), estimatedMinutes: "10-20" }, nextStep(p));
    }
  );

  server.registerTool(
    "get_video_status",
    {
      title: "Check a video",
      description:
        "Where a video is: its stage (working, \"ready\" or \"error\"), what it is doing now, its export, and what to call next. " +
        "Poll about once a minute while it is working; more often only wastes requests.",
      inputSchema: z.object({ project_id: ProjectId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("GET", `/projects/${encodeURIComponent(project_id)}`);
      if (r.status !== 200) return fail(r);
      const p = r.body as Project;
      return ok(summary(p), nextStep(p));
    }
  );

  server.registerTool(
    "confirm_brief",
    {
      title: "Confirm the brief",
      description: "Continue a video that stopped at stage \"brief\": accepts the written brief as it is and builds the film. Only needed when get_video_status says so.",
      inputSchema: z.object({ project_id: ProjectId }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/brief`, {});
      if (r.status !== 202) return fail(r);
      return ok({ projectId: project_id, confirmed: true }, "Building the film now. Check get_video_status in about a minute.");
    }
  );

  server.registerTool(
    "revise_video",
    {
      title: "Change a finished video",
      description:
        "Ask for a change to a video whose stage is \"ready\", in plain words (e.g. \"make the second scene shorter\", \"use a darker background\"). " +
        "Priced as a typical revision on the video's model (see get_credits), metered: applied straight away when the estimate is small; otherwise it " +
        "waits for confirm_revision with its price shown in get_video_status. Refunded if the change fails. Takes a few minutes: poll get_video_status until it is \"ready\" again.",
      inputSchema: z.object({ project_id: ProjectId, instruction: z.string().min(1).max(1200).describe("The change, in plain words.") }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id, instruction }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/chat`, { message: instruction });
      if (r.status !== 202) return fail(r);
      return ok({ projectId: project_id, revising: true }, "Working on the change. Check get_video_status in about a minute.");
    }
  );

  server.registerTool(
    "confirm_revision",
    {
      title: "Approve or drop a priced change",
      description:
        "A change asked for with revise_video that costs more than a small one waits for approval; get_video_status shows what it does and its price. " +
        "Ask the user, then call this with confirm true to go ahead (the credits are charged then) or false to drop it.",
      inputSchema: z.object({ project_id: ProjectId, confirm: z.boolean().describe("true to make the change at the quoted price, false to drop it.") }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id, confirm }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/chat/${confirm ? "confirm" : "cancel"}`, {});
      if (r.status !== 202 && r.status !== 200) return fail(r);
      return confirm
        ? ok({ projectId: project_id, revising: true }, "Working on the change. Check get_video_status in about a minute.")
        : ok({ projectId: project_id, dropped: true }, "Dropped. The video is unchanged.");
    }
  );

  server.registerTool(
    "stop_video",
    {
      title: "Stop what a video is doing",
      description:
        "Stop the work running on a video: making it, a revision, or an export. Credits already charged for that work are NOT refunded, " +
        "so only call this when the user asks to stop. A stopped video can be run again from the web app; a stopped export with export_video.",
      inputSchema: z.object({ project_id: ProjectId }),
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/stop`, {});
      if (r.status !== 202) return fail(r);
      return ok({ projectId: project_id, stopping: true }, "Stopping. Check get_video_status in a few seconds.");
    }
  );

  server.registerTool(
    "export_video",
    {
      title: "Export to MP4",
      description:
        "Render a \"ready\" video to an MP4 (included in the video's price). " +
        "Takes about 1-10 minutes: poll get_video_status until the export state is \"done\", then call get_download_url.",
      inputSchema: z.object({
        project_id: ProjectId,
      }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/render`, {});
      if (r.status !== 202) return fail(r);
      return ok({ projectId: project_id, exporting: true }, "Exporting. Check get_video_status in about 30 seconds.");
    }
  );

  server.registerTool(
    "get_download_url",
    {
      title: "Get the MP4 link",
      description: "A link to download an exported video's MP4. It works without signing in and expires after 24 hours; call again for a fresh one.",
      inputSchema: z.object({ project_id: ProjectId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("GET", `/projects/${encodeURIComponent(project_id)}/download-url`);
      if (r.status !== 200) return fail(r);
      const { url, expiresAt } = r.body as { url: string; expiresAt: number };
      return ok({ projectId: project_id, url, expiresAt: new Date(expiresAt).toISOString() });
    }
  );

  server.registerTool(
    "list_videos",
    {
      title: "List videos",
      description: "The account's videos, newest first, with their projectIds and stages.",
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(48).default(12),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ offset, limit }) => {
      const r = await rest("GET", `/projects?offset=${offset}&limit=${limit}`);
      if (r.status !== 200) return fail(r);
      return ok(r.body);
    }
  );

  server.registerTool(
    "get_credits",
    {
      title: "Credits and prices",
      description: "The account's credit balance, what each action costs in credits, and the credit packs for sale (for buy_credits). Check before making a video if unsure.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const r = await rest("GET", "/billing");
      if (r.status !== 200) return fail(r);
      const b = BillingBody.parse(r.body);
      if (!b.enabled) return ok({ payments: "off" }, "Payments aren't switched on for this server; videos are limited by the account's monthly allowance instead.");
      const packs = b.products.filter((p) => p.kind === "pack").map((p) => ({ sku: p.sku, name: p.name, priceUsd: p.priceCents / 100, credits: p.credits }));
      return ok({ balance: b.balance.total, costs: b.costs, packs, buyMore: `${config.appOrigin}/billing` });
    }
  );

  server.registerTool(
    "buy_credits",
    {
      title: "Buy a credit pack",
      description:
        "Start buying a credit pack (sku from get_credits) for the user. Returns a checkout link: give it to the user to approve the payment themselves " +
        "(with PayPal on this server); nothing is charged until they do, and you can't approve it for them. Then call check_purchase with the orderId. " +
        "project_id: a free preview waiting for this purchase; the user's browser goes back to it after paying.",
      inputSchema: z.object({
        sku: z.string().min(1).max(64).describe("The pack's sku, from get_credits."),
        project_id: ProjectId.optional().describe("A free preview to finish once paid, if any."),
      }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ sku, project_id }) => {
      const r = await rest("POST", "/billing/checkout", { sku, ...(project_id ? { projectId: project_id } : {}) });
      if (r.status !== 200) return fail(r);
      const { url, orderId } = CheckoutBody.parse(r.body);
      return ok(
        { checkoutUrl: url, ...(orderId ? { orderId } : {}), sku },
        `Give the user this link to pay: ${url}\nOnly they can approve the payment. Once they say they've paid, call check_purchase${orderId ? ` with order_id "${orderId}"` : ""}.`
      );
    }
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Check a purchase",
      description:
        "Whether a purchase started with buy_credits has gone through, and the balance. With order_id, a payment the user has approved is completed here and its credits added. " +
        "Call it after the user says they've paid (not in a loop).",
      inputSchema: z.object({ order_id: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/).optional().describe("The orderId buy_credits returned.") }),
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ order_id }) => {
      if (order_id) {
        const r = await rest("GET", `/billing/checkout-status?order_id=${encodeURIComponent(order_id)}`);
        if (r.status !== 200) return fail(r);
        const s = StatusBody.parse(r.body);
        const hint =
          s.state === "paid"
            ? s.credited
              ? "Paid; the credits are on the balance. A free preview waiting for them: call finish_preview."
              : "Paid; the credits are on their way. Check again in a minute."
            : s.state === "failed"
              ? "The payment didn't go through; nothing was charged. Call buy_credits for a new link if the user wants to try again."
              : "Not paid yet: the user hasn't approved it. Ask them to finish on the checkout page, then check again.";
        return ok(s, hint);
      }
      // no order id (a hosted checkout that doesn't return one): catch up on the account's payments
      const sync = await rest("POST", "/billing/sync", {});
      if (sync.status !== 200) return fail(sync);
      const b = await rest("GET", "/billing");
      if (b.status !== 200) return fail(b);
      return ok({ balance: BillingBody.parse(b.body).balance.total });
    }
  );

  server.registerTool(
    "finish_preview",
    {
      title: "Finish a free preview",
      description:
        "Build the rest of a free preview (stage \"preview\") once the account has credits: the video's credits are held now and it is made like any other video. " +
        "Out of credits: call buy_credits first. Then poll get_video_status about once a minute.",
      inputSchema: z.object({ project_id: ProjectId }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id }) => {
      const r = await rest("POST", `/projects/${encodeURIComponent(project_id)}/build`, {});
      // the user's browser finished it already, coming back from checkout
      if (r.status === 409 && /already paid/.test(ErrorBody.safeParse(r.body).data?.error ?? "")) {
        return ok({ projectId: project_id, finishing: true }, "It's already being finished. Check get_video_status in about a minute.");
      }
      if (r.status !== 202) return fail(r);
      return ok({ projectId: project_id, finishing: true }, "Building the full video now (10-20 minutes). Check get_video_status in about a minute.");
    }
  );

  return server;
};

const bearer = (req: express.Request): string | undefined => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return m ? m[1].trim() : undefined;
};

/** Whether a bearer token signs someone in: an API key, or a Supabase access token (an OAuth-connected app's or a session's). */
const signsIn = async (token: string | undefined): Promise<boolean> => {
  if (!token) return false;
  if (isApiKey(token)) return !!(await ownerOfKey(token).catch(() => null));
  return verifyToken(token).then(() => true, () => false);
};

/** Mount /api/mcp and its sign-in discovery. Before the API router: it reads the raw body and authenticates itself. */
export const mountMcp = (app: express.Express): void => {
  const handler = createMcpHandler((ctx) => buildServer(restFor(ctx.authInfo?.token)), { legacy: "stateless" });

  // The protected resource metadata: this MCP server, signed in through Supabase Auth's OAuth server
  app.get(RESOURCE_METADATA_PATH, (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({
      resource: `${config.appOrigin}/api/mcp`,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "XLaunch",
      resource_documentation: `${config.appOrigin}/#claude`,
    });
  });

  app.all("/api/mcp", async (req, res) => {
    const token = bearer(req);
    // With accounts, every MCP call is signed in; without (local development) the server is open.
    if (dbEnabled() && !(await signsIn(token))) {
      res
        .status(401)
        // where an OAuth client (claude.ai, Claude Code) learns how to sign in
        .set("WWW-Authenticate", `Bearer resource_metadata="${config.appOrigin}${RESOURCE_METADATA_PATH}"`)
        .json({ error: `Sign in to XLaunch: connect by OAuth, or send an API key as Authorization: Bearer xl_... (make one at ${config.appOrigin}/billing).` });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const request = new Request(`http://${req.headers.host ?? "localhost"}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" || body.length === 0 ? undefined : body,
    });

    try {
      const response = await handler.fetch(request, token ? { authInfo: { token, clientId: "api-key", scopes: [] } } : undefined);
      res.status(response.status);
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (!response.body) return void res.end();
      Readable.fromWeb(response.body as import("stream/web").ReadableStream).pipe(res);
    } catch (error) {
      console.error("[mcp]", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed." });
      else res.end();
    }
  });
};
