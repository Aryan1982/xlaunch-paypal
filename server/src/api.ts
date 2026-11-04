import express from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

import { AUDIO_DIR } from "./audio";
import { coderModelFor, config, DEFAULT_MODEL, effortFor, modelLabel, OFFERED_MODELS, OPUS, threeDOpen } from "./config";
import { accountOf, authenticate, type Account } from "./auth";
import { downloadToken, verifyAssetToken, verifyDownloadToken } from "./lib/sign";
import { launchOfferEnds, productsForSale } from "./billing/catalog";
import { claimPreview, clientIp, freePreviewsLeft, freePreviewsPerDay, previewOf } from "./billing/preview";
import { ANONYMOUS_EVENTS, CLIENT_EVENTS, SOURCED_EVENTS, STEP_SOURCES, recordFunnel, sourceOf } from "./usage/funnel";
import { priceList } from "./billing/pricelist";
import { balanceOf, billingEnabled, charges, hasPurchased, paymentProvider, refund, refundPart } from "./billing/credits";
import { createKey, listKeys, revokeKey } from "./apikeys";
import { mountMcp } from "./mcp";
import { listShowcase, MOTION_SHOWCASE_DIR, motionShowcase, showcasePoster, showcaseVideo } from "./showcase";
import { dbEnabled } from "./db";
import { billingEnvironment, checkoutStatus, createCheckout, createPortal, productsOnSale, syncPurchases } from "./billing/checkout";
import { handleWebhook } from "./billing/dodo";
import { BadSignature } from "./billing/events";
import { handlePaypalWebhook, PAYPAL_WEBHOOK_HEADERS } from "./billing/paypal";
import { chargeUpTo, chargeVideo, ensureVideoCharge, newRef, settleVideo } from "./billing/jobs";
import { activityOf } from "./billing/activity";
import { assertQuota, monthUsage } from "./usage/quota";
import { recordVideo } from "./usage/ledger";
import { ensureWorkdir, restoreFile, restoreRender } from "./workdir";
import { assertPublicUrl } from "./ingest/netguard";
import { ReferenceUploadSchema, saveReferences } from "./ingest/uploads";
import { handle, HttpError, PROJECT_ID } from "./lib/http";
import { assertFilmAgent } from "./lib/retired";
import { extractUrl } from "./lib/url";
import { UpstreamError, InferenceError } from "./opencode";
import {
  busyProjects,
  isBusy,
  runAll,
  runFromPreview,
  runPreview,
  isUnpaidPreview,
  runChat,
  queueChange,
  stopJob,
  confirmChat,
  cancelChat,
  type ChatPayment,
  runResume,
} from "./pipeline";
import { motionSource } from "./pipeline/motion-agent";
import { isRendering, renderFile, renderingProjects, runRender, stopRender } from "./pipeline/render";
import {
  assertId,
  assetsDir,
  createProject,
  deleteProject,
  getProject,
  listSummariesOf,
  projectDir,
  subscribe,
  updateProject,
} from "./store";
import { type Project, EFFORTS, FILM_MODES, MOTION_RUNNERS } from "./types";
import { publicShare, sharedProject, shareProject, unshareProject } from "./share";

const idOf = (req: express.Request): string => assertId(String(req.params.projectId ?? ""));

/** Fire-and-forget: pipelines report through the project, not the request. */
const detach = (work: Promise<unknown>): void => {
  work.catch((error) => console.error("[api] detached job failed:", error));
};


const CreateSchema = z.object({
  prompt: z.string().min(3).max(1200),
  /** Exact number of scenes (default: the writer decides). */
  scenes: z.number().int().min(1).max(10).optional(),
  /** Model for the film, one of GET /models (default: Sonnet 5.5; anything else gets it too). */
  model: z.string().max(80).optional(),
  /** Up to 3 reference images (screenshots of the product, a look the user wants). */
  references: ReferenceUploadSchema.optional(),
  /** A "2d" film (default) or a "3d" one (low-poly three.js), both made by the film agent; "motion" is the same as "2d". */
  mode: z.enum(FILM_MODES).optional(),
  /** A motion film's agent: signed in with the Claude Code login or the Anthropic API (default: the server's MOTION_RUNNER). */
  runner: z.enum(MOTION_RUNNERS).optional(),
  /** Narrate the video (only where the pipeline records narration). */
  narration: z.boolean().optional(),
  /** "16:9" landscape (default) or "9:16" vertical. */
  aspect: z.enum(["16:9", "9:16"]).optional(),
  /** How hard Opus 5.5 works: "low", "medium" or "high" (default high). Sonnet 5.5 always works at high. */
  effort: z.enum(EFFORTS).optional(),
});

const ChatSchema = z.object({ message: z.string().min(1).max(1200), model: z.string().max(80).optional(), effort: z.enum(EFFORTS).optional(), references: ReferenceUploadSchema.optional() });

/** Generation jobs and exports one user may run at once (admins are not limited). */
const USER_JOBS = Math.max(1, Number(process.env.MAX_USER_JOBS ?? 1));
const USER_RENDERS = Math.max(1, Number(process.env.MAX_USER_RENDERS ?? 1));

const runningOf = async (account: Account, ids: string[]): Promise<number> => {
  let n = 0;
  for (const id of ids) {
    const p = await getProject(id).catch(() => null);
    if (p?.userId === account.id) n += 1;
  }
  return n;
};

/** 429 when the caller already has as many jobs (or exports) running as the plan allows. */
const assertCapacity = async (account: Account, kind: "job" | "render"): Promise<void> => {
  if (account.isAdmin) return;
  const [ids, max] = kind === "job" ? [busyProjects(), USER_JOBS] : [renderingProjects(), USER_RENDERS];
  if ((await runningOf(account, ids)) >= max) {
    throw new HttpError(
      429,
      kind === "job"
        ? "One of your videos is still being worked on. Wait for it to finish, then try again."
        : "One of your exports is still running. Wait for it to finish, then try again.",
      { code: "busy" }
    );
  }
};

/**
 * The film's source for the browser bundler: what its owner's page plays, and a share link too.
 * A film plays its agent's workspace as it is (pipeline/motion-agent.ts); a film from the retired
 * scene studio has no source any more (410).
 */
const playableSource = async (project: Project) => {
  assertFilmAgent(project);
  if (!project.motionAgent?.runs) throw new HttpError(404, "This project has no generated video yet.");
  await ensureWorkdir(project.id);
  return { version: project.version, ...motionSource(project.id) };
};

export function registerApi(app: express.Express): void {
  // The payment webhooks: before the router, because the signature covers the raw
  // body (the router parses JSON) and the provider has no session (the router signs in).
  const webhook =
    (names: readonly string[], apply: typeof handleWebhook): express.RequestHandler =>
    (req, res) => {
      const headers: Record<string, string> = {};
      for (const name of names) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      apply(body, headers).then(
        (outcome) => {
          console.log(`[billing] ${outcome.note}`);
          res.json({ received: true });
        },
        (error) => {
          if (error instanceof BadSignature) return void res.status(401).json({ error: error.message });
          if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
          // RetryLater or a database error: the provider delivers again
          console.error("[billing] webhook not applied:", error instanceof Error ? error.message : error);
          res.status(500).json({ error: "Not applied yet." });
        }
      );
    };
  const raw = express.raw({ type: "*/*", limit: "1mb" });
  app.post("/api/billing/webhook", raw, webhook(["webhook-id", "webhook-signature", "webhook-timestamp"], handleWebhook));
  app.post("/api/billing/paypal/webhook", raw, webhook(PAYPAL_WEBHOOK_HEADERS, handlePaypalWebhook));

  // The MCP server: also before the router (raw body, its own API-key check).
  mountMcp(app);

  const router = express.Router();
  // room for up to 3 reference images (compressed in the browser) in one request
  router.use(express.json({ limit: "24mb" }));

  // --- who is calling ---------------------------------------------------
  //
  // Everything needs a signed-in account, except the home page's example
  // videos, the sound-effect library (a film's live preview plays from it), a film opened by its share link (share.ts),
  // project assets requested with a valid signature (the renderer and the
  // sandboxed preview have no session; lib/sign.ts), and an export downloaded
  // through a signed link (an MCP client or a shared link has no session).

  /** Launch pricing while it lasts: when it ends (the struck-through regular prices apply from the day after). */
const offerOf = (): { name: string; endsAt: string } | null => {
  const ends = launchOfferEnds();
  return ends ? { name: "Launch pricing", endsAt: ends } : null;
};

  // a project's assets, and a motion film's public files (its live preview)
  const SIGNED_ASSET = /^\/projects\/([A-Za-z0-9_-]{1,64})\/(?:assets\/[^/]+|motion\/public\/.+)$/;
  const SIGNED_DOWNLOAD = /^\/projects\/([A-Za-z0-9_-]{1,64})\/download$/;
  router.use(
    handle(async (req, res, next) => {
      if (req.method === "GET" && (req.path.startsWith("/showcase") || req.path.startsWith("/share/") || req.path.startsWith("/audio/sfx/") || req.path === "/pricing" || req.path === "/models" || req.path === "/previews")) return next();
      // funnel steps from the page, signed in or not (a visit, Generate pressed before sign-in): the account when there is one
      if (req.method === "POST" && req.path === "/funnel") {
        res.locals.account = await authenticate(req).catch(() => undefined);
        return next();
      }
      const asset = req.method === "GET" ? SIGNED_ASSET.exec(req.path) : null;
      if (asset && verifyAssetToken(asset[1], req.query.exp, req.query.sig)) {
        res.locals.signed = asset[1];
        return next();
      }
      const download = req.method === "GET" ? SIGNED_DOWNLOAD.exec(req.path) : null;
      if (download && verifyDownloadToken(download[1], req.query.exp, req.query.sig)) {
        res.locals.signed = download[1];
        return next();
      }
      const account = await authenticate(req);
      res.locals.account = account;
      next();
    })
  );

  // Every :projectId route: the project must exist and belong to the caller.
  router.param("projectId", (req, res, next, raw) => {
    void (async () => {
      const id = assertId(String(raw));
      if (res.locals.signed === id) return next();
      const account = accountOf(res);
      const project = await getProject(id).catch(() => null);
      // a project its owner deleted is kept for admins only
      if (!project || ((project.userId !== account.id || project.deletedAt) && !account.isAdmin)) {
        throw new HttpError(404, "Project not found.");
      }
      next();
    })().catch(next);
  });

  // --- example videos on the home page (public) -------------------------

  /** The price list, for the public home page and its structured data. Same numbers as /billing. */
  router.get("/pricing", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    // with payments on, only what can be bought (as /billing lists it)
    const products = billingEnabled() ? productsOnSale() : productsForSale();
    res.json({ currency: "USD", products, offer: offerOf(), costs: priceList() });
  });

  /** One page of examples, in their curated order (showcase_videos.position): ?mode=2d|3d&offset=0&limit=12 (no limit: all of them). */
  router.get("/showcase", handle(async (req, res) => {
    const q = z
      .object({
        mode: z.enum(["2d", "3d"]).optional(),
        /** Where the examples are shown: the home page (default) or the sign-in page. */
        place: z.enum(["home", "login"]).default("home"),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
        limit: z.coerce.number().int().min(1).max(48).optional(),
      })
      .parse(req.query);
    const all = (await listShowcase(q.place)).filter((i) => !q.mode || i.mode === q.mode);
    const items = q.limit ? all.slice(q.offset, q.offset + q.limit) : all.slice(q.offset);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ items, total: all.length, hasMore: q.offset + items.length < all.length });
  }));

  router.get("/showcase/:file", handle(async (req, res) => {
    const m = /^([A-Za-z0-9][A-Za-z0-9 _-]{0,79})\.(mp4|jpg)$/.exec(String(req.params.file));
    const file = m ? await (m[2] === "mp4" ? showcaseVideo(m[1]!) : showcasePoster(m[1]!)) : null;
    if (!file) throw new HttpError(404, "No such example.");
    res.sendFile(file, { maxAge: m![2] === "jpg" ? "7d" : "1h", headers: { "Cross-Origin-Resource-Policy": "same-origin" } });
  }));

  /** Motion films made with XLaunch, shown while a motion film is being made (assets/motion-showcase/films.json). */
  router.get("/showcase-motion", handle(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({ items: motionShowcase() });
  }));

  router.get("/showcase-motion/:file", handle(async (req, res) => {
    const m = /^([a-z0-9-]{1,40})\.(mp4|jpg)$/.exec(String(req.params.file));
    if (!m || !motionShowcase().some((f) => f.id === m[1])) throw new HttpError(404, "No such film.");
    res.sendFile(path.join(MOTION_SHOWCASE_DIR, `${m[1]}.${m[2]}`), { maxAge: "7d", headers: { "Cross-Origin-Resource-Policy": "same-origin" } });
  }));

  /** The models on offer (2D and 3D films alike): Sonnet 5.5 (the default, always at high effort) and Opus 5.5 (low, medium or high). */
  router.get("/models", handle(async (_req, res) => {
    res.json({
      models: OFFERED_MODELS.map((m) => ({ ...m, chooseEffort: m.id === OPUS })),
      default: DEFAULT_MODEL,
      /** What a free preview is made with (at high effort), whatever was picked. */
      preview: { id: config.motion.previewModel, label: modelLabel(config.motion.previewModel) },
      /** Opus's effort unless the user picks another. */
      effort: "high",
    });
  }));

  /** Free previews left today (UTC) across everyone, for the composer's free line; public, never cached. */
  router.get("/previews", handle(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ left: await freePreviewsLeft(), perDay: freePreviewsPerDay() });
  }));

  router.get("/me", handle(async (_req, res) => {
    const account = accountOf(res);
    res.json({
      /** The account id: a project's page compares it with project.userId (e.g. sharing is for the owner only). */
      id: account.id,
      email: account.email,
      plan: account.plan,
      isAdmin: account.isAdmin,
      /** May pick how the film agent signs in (subscription or API): an admin, or an account on MOTION_SUBSCRIPTION_ACCOUNTS. */
      chooseRunner: account.isAdmin || config.motion.subscriptionAccounts.includes(account.email.toLowerCase()),
      /** May pick the model and effort even for a free preview: an admin, or an account on MOTION_MODEL_PICKER_ACCOUNTS. */
      chooseModel: account.isAdmin || config.motion.modelPickerAccounts.includes(account.email.toLowerCase()),
      limits: { videos: account.videosPerMonth, tokens: account.tokensPerMonth, storageMb: account.storageMb },
      /** May make 3D videos: open to everyone, or an admin while 3D is tested. */
      threeD: threeDOpen() || account.isAdmin,
      /** Hasn't bought anything yet: makes a free preview, in 2D, with the preview model at high effort. */
      free: charges(account) && !(await hasPurchased(account.id)),
      usage: await monthUsage(account.id),
    });
  }));

  // --- billing ----------------------------------------------------------

  /** Balance, plan, what's for sale and what things cost. */
  router.get("/billing", handle(async (_req, res) => {
    const account = accountOf(res);
    res.set("Cache-Control", "no-store");
    res.json({
      enabled: billingEnabled(),
      provider: paymentProvider(),
      environment: billingEnabled() ? billingEnvironment() : null,
      // public by design: the PayPal JS SDK loads with it
      ...(billingEnabled() && paymentProvider() === "paypal" ? { paypalClientId: process.env.PAYPAL_CLIENT_ID } : {}),
      balance: await balanceOf(account.id),
      products: productsOnSale(),
      offer: offerOf(),
      costs: priceList(),
    });
  }));

  router.post("/billing/checkout", handle(async (req, res) => {
    const { sku, projectId, model } = z
      .object({ sku: z.string().max(64), projectId: z.string().regex(PROJECT_ID).optional(), model: z.string().max(80).optional() })
      .parse(req.body ?? {});
    const account = accountOf(res);
    // a preview waiting for this purchase: back to it after checkout (only the caller's own)
    const waiting = projectId ? await getProject(projectId).catch(() => null) : null;
    const project = waiting && waiting.userId === account.id && isUnpaidPreview(waiting) ? waiting.id : undefined;
    // the model picked on the preview is the one that finishes it once paid
    if (project && model) {
      await updateProject(project, (p) => {
        p.options.model = coderModelFor(model);
      });
    }
    const checkout = await createCheckout(account, sku, project);
    void recordFunnel("checkout_started", { userId: account.id, projectId: project ?? null });
    res.json(checkout);
  }));

  /** Back from checkout: what it really came to, by the id the provider put on the return URL (only the caller's own). PayPal's order id comes back as `token`. */
  router.get("/billing/checkout-status", handle(async (req, res) => {
    const id = z.string().regex(/^[A-Za-z0-9_-]{4,80}$/);
    const q = z.object({ payment_id: id.optional(), subscription_id: id.optional(), order_id: id.optional() }).parse(req.query);
    if (!q.payment_id && !q.subscription_id && !q.order_id) throw new HttpError(400, "No checkout to look up.");
    res.set("Cache-Control", "no-store");
    res.json(await checkoutStatus(accountOf(res), { paymentId: q.payment_id, subscriptionId: q.subscription_id, orderId: q.order_id }));
  }));

  /** Back from checkout: apply any of the caller's payments the webhook hasn't (yet). */
  router.post("/billing/sync", handle(async (_req, res) => {
    res.json({ added: await syncPurchases(accountOf(res)) });
  }));

  /** The caller's credit history (purchases, charges, refunds), newest first. */
  router.get("/billing/activity", handle(async (_req, res) => {
    const account = accountOf(res);
    res.set("Cache-Control", "no-store");
    res.json({ items: billingEnabled() ? await activityOf(account.id) : [] });
  }));

  router.post("/billing/portal", handle(async (_req, res) => {
    res.json({ url: await createPortal(accountOf(res)) });
  }));

  // --- API keys (programs and MCP clients) ------------------------------
  //
  // Managed only from a signed-in session: a key can't list, make or revoke keys.

  const sessionOnly = (res: express.Response): Account => {
    const account = accountOf(res);
    if (account.viaKey) throw new HttpError(403, "API keys can only be managed from the web app.");
    if (!dbEnabled()) throw new HttpError(503, "API keys need accounts (Supabase), which this server doesn't have.");
    return account;
  };

  router.get("/keys", handle(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ keys: await listKeys(sessionOnly(res).id) });
  }));

  router.post("/keys", handle(async (req, res) => {
    const account = sessionOnly(res);
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body ?? {});
    // the API and MCP server are for paying customers once payments are on
    if (billingEnabled() && !account.isAdmin && !(await hasPurchased(account.id))) {
      throw new HttpError(402, "API keys come with any plan or credit pack.", { code: "credits" });
    }
    res.set("Cache-Control", "no-store");
    res.status(201).json(await createKey(account.id, name));
  }));

  router.delete("/keys/:keyId", handle(async (req, res) => {
    const account = sessionOnly(res);
    const id = z.string().uuid().parse(req.params.keyId);
    await revokeKey(account.id, id);
    res.status(204).end();
  }));

  // --- share links (share.ts) -------------------------------------------
  //
  // The owner makes or turns off a project's public link; anyone with the
  // token may watch the film (signed in or not), and see nothing else of it.

  router.post("/projects/:projectId/share", handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ token: await shareProject(accountOf(res), idOf(req)) });
  }));

  router.delete("/projects/:projectId/share", handle(async (req, res) => {
    await unshareProject(accountOf(res), idOf(req));
    res.status(204).end();
  }));

  router.get("/share/:token", handle(async (req, res) => {
    const project = await sharedProject(String(req.params.token));
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    res.json(publicShare(project));
  }));

  router.get("/share/:token/source", handle(async (req, res) => {
    const project = await sharedProject(String(req.params.token));
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    res.json(await playableSource(project));
  }));

  // --- projects ---------------------------------------------------------

  router.get("/projects", handle(async (req, res) => {
    const { offset, limit } = z
      .object({ offset: z.coerce.number().int().min(0).max(10_000).default(0), limit: z.coerce.number().int().min(1).max(48).default(12) })
      .parse(req.query);
    res.json(await listSummariesOf(accountOf(res).id, offset, limit));
  }));

  router.post("/projects", handle(async (req, res) => {
    const account = accountOf(res);
    const body = CreateSchema.parse(req.body);
    // every video is made by the film agent (mode "motion"); a 3D one is film3d
    const requested = body.mode ?? "2d";
    const film3d = requested === "3d";
    if (requested === "3d" && !threeDOpen() && !account.isAdmin) {
      throw new HttpError(403, "3D videos open soon. Make a 2D one for now.", { code: "3d_closed" });
    }
    // a narrated film: the agent writes the voice-over and records each line with ElevenLabs (off without a key)
    const narration = body.narration === true;
    const aspect = body.aspect ?? "16:9";
    await assertQuota(account, "video");
    await assertCapacity(account, "job");
    const { url: found, rest } = extractUrl(body.prompt);
    if (!found) throw new HttpError(400, "Add your website URL to your prompt.");
    let url: URL;
    try {
      url = await assertPublicUrl(found);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    // the film agent: everyone's runs on the API key with only its film tools; an admin picks how it signs in and keeps the
    // shell; an account on MOTION_SUBSCRIPTION_ACCOUNTS picks too (the subscription unless it asks for the API), without the shell
    const subscribed = config.motion.subscriptionAccounts.includes(account.email.toLowerCase());
    const motionRunner = account.isAdmin ? (body.runner ?? config.motion.runner) : subscribed ? (body.runner ?? ("claude-code" as const)) : ("api" as const);
    const model = coderModelFor(body.model);
    const project = await createProject(url.href, { prompt: body.prompt, notes: rest, length: config.motion.seconds, model, effort: effortFor(model, body.effort), mode: "motion", narration, aspect, ...(body.scenes ? { scenes: body.scenes } : {}), motionRunner, motionShell: account.isAdmin, ...(film3d ? { film3d } : {}) }, account.id);
    // charged once the project exists (the ledger names it). Out of credits: the account's one free
    // preview (the whole film planned, its opening built), else the project is removed again
    let preview = false;
    try {
      await chargeVideo(account, project);
    } catch (error) {
      const short = error instanceof HttpError && error.details.code === "credits";
      // 3D isn't part of the free preview: it comes with any plan or pack
      if (short && requested === "3d") {
        await deleteProject(project.id).catch(() => undefined);
        throw new HttpError(402, "3D videos come with any plan or credit pack. Make a 2D one for free, or get credits for 3D.", { ...(error as HttpError).details, code: "credits", paidOnly: "3d" });
      }
      const claim = short ? await claimPreview(account, project.id, clientIp(req.headers, req.socket.remoteAddress)) : "refused";
      preview = claim === "claimed";
      if (!preview) {
        await deleteProject(project.id).catch(() => undefined);
        // today's free previews are all taken: the paid way to the film instead
        if (claim === "full") {
          throw new HttpError(402, "Today's free previews are taken. Get the full film for $15 — refunded within 7 days if it's not for you.", { ...(error as HttpError).details, code: "credits", previewsFull: true });
        }
        // out of credits with the free preview already used: say so, and where it is (when it is still there)
        const used = short ? await previewOf(account) : null;
        const waiting = used ? await getProject(used).then((p) => (p.deletedAt ? null : p)).catch(() => null) : null;
        if (short && used) {
          const name = waiting?.profile?.name || waiting?.title;
          throw new HttpError(
            402,
            waiting
              ? `You've used your free preview${name ? ` (${name})` : ""}. Finish it, or get credits to make more videos.`
              : "You've used your free preview. Get credits to make more videos.",
            { ...(error as HttpError).details, code: "credits", previewUsed: true, ...(waiting ? { previewProjectId: waiting.id } : {}) }
          );
        }
        throw error;
      }
      await updateProject(project.id, (p) => {
        p.options.freePreview = true;
        // made with config.motion.previewModel at high effort (it is what sells the film), recorded as the project's
        // model and effort so the app shows what it is made with, and the finish matches it; an account on
        // MOTION_MODEL_PICKER_ACCOUNTS keeps the model and effort it picked
        if (config.motion.modelPickerAccounts.includes(account.email.toLowerCase())) return;
        p.options.model = config.motion.previewModel;
        p.options.effort = "high";
      });
    }
    recordVideo(project.id, account.id);
    if (body.references?.length) {
      try {
        const names = await saveReferences(project.id, body.references);
        await updateProject(project.id, (p) => {
          p.options.references = names;
          // shown under the prompt in the chat
          const first = p.chat.find((m) => m.kind === "prompt");
          if (first) first.images = names;
        });
      } catch (error) {
        await refund((await getProject(project.id)).charge, "video not started");
        await deleteProject(project.id).catch(() => undefined);
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
    }
    if (preview) {
      void recordFunnel("preview_started", { userId: account.id, projectId: project.id, model: project.options.model });
      detach(
        runPreview(project.id).then(async () => {
          if ((await getProject(project.id)).stage === "preview") await recordFunnel("preview_ready", { userId: account.id, projectId: project.id, model: project.options.model });
        })
      );
    } else detach(settleVideo(project.id, () => runAll(project.id)));
    res.status(201).json(await getProject(project.id));
  }));

  /**
   * A free preview, paid for: hold the video's credits (the model may change
   * first), then resume its session to build the rest of the film it planned. Out of
   * credits: 402 {code: "credits"}, and the page offers a pack or plan.
   */
  router.post("/projects/:projectId/build", handle(async (req, res) => {
    const id = idOf(req);
    const account = accountOf(res);
    const project = await getProject(id);
    assertFilmAgent(project);
    if (!isUnpaidPreview(project)) throw new HttpError(409, "This video is already paid for.");
    if (project.stage !== "preview") throw new HttpError(409, "Wait for the preview to finish first.");
    guard(id);
    await assertQuota(account, "tokens");
    await assertCapacity(account, "job");
    const { model, effort } = z.object({ model: z.string().max(80).optional(), effort: z.enum(EFFORTS).optional() }).parse(req.body ?? {});
    if (model || effort) {
      await updateProject(id, (p) => {
        if (model) p.options.model = coderModelFor(model);
        p.options.effort = effortFor(p.options.model, effort ?? p.options.effort);
      });
    }
    await chargeVideo(account, await getProject(id));
    // nothing was charged (an admin finishing it, e.g. scripts/gift-finish.ts, or billing off): the film is free,
    // and no longer an unpaid preview, so its owner gets the whole film
    await updateProject(id, (p) => void (p.charge ??= { ref: `free:${id}`, credits: 0, state: "delivered", charged: 0, usd: 0 }));
    void recordFunnel("render_started", { userId: account.id, projectId: id, model: (await getProject(id)).options.model });
    detach(
      settleVideo(id, () => runFromPreview(id)).then(async () => {
        if ((await getProject(id)).stage === "ready") await recordFunnel("video_ready", { userId: account.id, projectId: id, model: (await getProject(id)).options.model });
      })
    );
    res.status(202).json({ ok: true });
  }));

  /**
   * A funnel step only the page sees. Anonymous steps are taken from anyone;
   * the rest only with a session. Never a 401 (the page would go to sign-in): unknown or unsigned steps are dropped.
   * A visit's source is worked out here; a refused Generate's and a sign-in page's come from the page.
   */
  router.post("/funnel", handle(async (req, res) => {
    const body = z
      .object({
        event: z.enum(CLIENT_EVENTS),
        projectId: z.string().max(40).optional(),
        visitor: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
        utm: z.string().max(120).optional(),
        referrer: z.string().max(500).optional(),
        source: z.enum(STEP_SOURCES).optional(),
      })
      .safeParse(req.body ?? {});
    const account = res.locals.account as Account | undefined;
    if (body.success && (account || (ANONYMOUS_EVENTS as readonly string[]).includes(body.data.event))) {
      const { event, projectId, visitor, utm, referrer, source } = body.data;
      void recordFunnel(event, {
        userId: account?.id ?? null,
        projectId: projectId ?? null,
        visitor: visitor ?? null,
        source:
          event === "visit"
            ? sourceOf(utm, referrer, new URL(config.appOrigin).hostname)
            : (SOURCED_EVENTS as readonly string[]).includes(event)
              ? (source ?? null)
              : null,
      });
    }
    res.status(204).end();
  }));

  router.get("/projects/:projectId", handle(async (req, res) => {
    res.json(await getProject(idOf(req)));
  }));

  /**
   * The owner's delete: a free preview can't be deleted; anything else leaves the user's side but is
   * kept, files and all, for admins (accessboard opens it in the app).
   */
  router.delete("/projects/:projectId", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    if (isUnpaidPreview(project) && !accountOf(res).isAdmin) throw new HttpError(403, "A free preview can't be deleted.");
    if (isBusy(id) || isRendering(id)) throw new HttpError(409, "Project is busy.");
    await updateProject(id, (p) => void (p.deletedAt ??= Date.now()));
    res.status(204).end();
  }));

  /** Live project snapshots over Server-Sent Events. */
  router.get("/projects/:projectId/events", handle(async (req, res) => {
    const id = idOf(req);
    const initial = await getProject(id);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (p: Project | null) => res.write(`data: ${JSON.stringify(p)}\n\n`);
    send(initial);
    const unsubscribe = subscribe(id, send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  }));

  // --- pipeline steps ---------------------------------------------------

  /** How a chat change is paid for, by this caller. */
  const chatPayment = (account: Account, id: string): ChatPayment => ({
    charges: charges(account),
    charge: (credits, label, least) => chargeUpTo(account, credits, least ?? credits, label, id, newRef("chat", id)),
    refund: async (held) => {
      await refund(held, "chat change failed");
    },
    refundPart: (held, credits) => refundPart(held, credits, "chat change: unused credits"),
  });

  const guard = (id: string) => {
    if (isBusy(id)) throw new HttpError(409, "This project is already working on something.");
  };

  router.post("/projects/:projectId/chat", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    assertFilmAgent(project);
    const { message, model, effort, references } = ChatSchema.parse(req.body);
    // an unpaid free preview is only its opening: finishing it (/build) opens the chat
    if (isUnpaidPreview(project)) throw new HttpError(409, "Finish this video to change it by chat.");
    // a film being made, changed or exported takes changes now and applies them once it is done
    const queue = project.stage !== "error" && (isBusy(id) || isRendering(id));
    // a film whose change failed is still the film it was: the next change starts from it
    const failedChange = project.stage === "error" && project.version > 0 && !isBusy(id);
    if (!queue) {
      if (project.stage !== "ready" && !failedChange) throw new HttpError(409, "Wait for the video to finish before requesting changes.");
      guard(id);
    }
    if (failedChange) {
      await updateProject(id, (p) => {
        p.stage = "ready";
        p.error = undefined;
        p.activity = "Your video is ready";
      });
    }
    await assertQuota(accountOf(res), "tokens");
    if (!queue) await assertCapacity(accountOf(res), "job");
    let refs: string[] = [];
    if (references?.length) {
      try {
        refs = await saveReferences(id, references, `ref-chat-${Date.now().toString(36)}`);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
    }
    // priced once planned (pipeline: runChat), not here
    const chosen = model && coderModelFor(model);
    // a new effort applies to this change and the ones after it (the job reads it when it starts); Sonnet's is always high
    if (effort || chosen) {
      await updateProject(id, (p) => {
        p.options.effort = effortFor(chosen || p.options.model, effort ?? p.options.effort);
      });
    }
    detach(queue ? queueChange(id, message.trim(), chatPayment(accountOf(res), id), chosen, refs) : runChat(id, message.trim(), chatPayment(accountOf(res), id), chosen, refs));
    res.status(202).json({ ok: true });
  }));

  /** Stop what is running: the generation job, else the export. What it was charged stays charged. */
  router.post("/projects/:projectId/stop", handle(async (req, res) => {
    const id = idOf(req);
    await getProject(id);
    if (!stopJob(id) && !stopRender(id)) throw new HttpError(409, "Nothing is running.");
    res.status(202).json({ ok: true });
  }));

  /** Go ahead with a chat change that was held for its price. */
  router.post("/projects/:projectId/chat/confirm", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    assertFilmAgent(project);
    if (!project.pendingChange) throw new HttpError(409, "There's no change waiting. Ask for it again.");
    guard(id);
    await assertCapacity(accountOf(res), "job");
    detach(confirmChat(id, chatPayment(accountOf(res), id)));
    res.status(202).json({ ok: true });
  }));

  router.post("/projects/:projectId/chat/cancel", handle(async (req, res) => {
    const id = idOf(req);
    guard(id);
    await cancelChat(id);
    res.json({ ok: true });
  }));

  router.post("/projects/:projectId/retry", handle(async (req, res) => {
    const id = idOf(req);
    const current = await getProject(id);
    assertFilmAgent(current);
    guard(id);
    // an unpaid preview that failed: the free part again; past it is the paid finish (/build)
    if (isUnpaidPreview(current)) {
      if (current.stage !== "error") throw new HttpError(409, "Finish the video to continue.");
      detach(runPreview(id));
      return void res.status(202).json({ ok: true });
    }
    await assertQuota(accountOf(res), "tokens");
    await assertCapacity(accountOf(res), "job");
    await ensureVideoCharge(accountOf(res), id);
    detach(settleVideo(id, () => runResume(id)));
    res.status(202).json({ ok: true });
  }));

  // --- preview source for the browser bundler ---------------------------

  router.get("/projects/:projectId/source", handle(async (req, res) => {
    const project = await getProject(idOf(req));
    res.set("Cache-Control", "no-store");
    res.json(await playableSource(project));
  }));

  /** A motion film's public file (an image the agent fetched, an attachment), for its live preview; signed like the assets. */
  router.get("/projects/:projectId/motion/public/*file", handle(async (req, res) => {
    const id = idOf(req);
    const parts = ([] as string[]).concat(req.params.file as string | string[]);
    if (parts.some((p) => !p || p === "." || p === "..")) throw new HttpError(404, "No such file.");
    const rel = `motion/public/${parts.join("/")}`;
    await restoreFile(id, rel);
    const file = path.join(projectDir(id), rel);
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "No such file.");
    }
    res.set({ "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" });
    res.set("Cache-Control", "public, max-age=3600");
    res.sendFile(file);
  }));

  /** A review still the film's agent rendered (review/r03/f0120.jpg, or a round's sheet.jpg), for the chat's timeline: its owner only. */
  router.get("/projects/:projectId/motion/review/:round/:file", handle(async (req, res) => {
    const id = idOf(req);
    const round = String(req.params.round);
    const name = String(req.params.file);
    if (!/^r\d{1,4}$/.test(round) || !/^(?:f\d{1,6}|sheet)\.jpg$/.test(name)) throw new HttpError(404, "No such frame.");
    const rel = `motion/review/${round}/${name}`;
    await restoreFile(id, rel);
    const file = path.join(projectDir(id), rel);
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "No such frame.");
    }
    // a film made again from scratch renders its rounds again under the same names: revalidated (ETag), not trusted
    res.set("Cache-Control", "private, no-cache");
    res.sendFile(file);
  }));

  // --- assets & thumbnail ----------------------------------------------

  router.get("/projects/:projectId/assets/:name", handle(async (req, res) => {
    const id = idOf(req);
    const name = path.basename(String(req.params.name));
    const file = path.join(assetsDir(id), name);
    await ensureWorkdir(id);
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "No such asset.");
    }
    res.set({ "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" });
    res.set("Cache-Control", "public, max-age=3600");
    res.sendFile(file);
  }));

  router.get("/projects/:projectId/thumbnail.jpg", handle(async (req, res) => {
    const file = path.join(projectDir(idOf(req)), "thumbnail.jpg");
    // a project list asks for many thumbnails: fetch just this file, not the whole project
    await restoreFile(idOf(req), "thumbnail.jpg");
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "No thumbnail yet.");
    }
    res.set({ "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" });
    res.set("Cache-Control", "no-cache");
    // the thumbnail is a copy of a check still, which is a PNG (older ones are JPEG)
    const head = Buffer.alloc(4);
    const handle = await fs.open(file, "r");
    await handle.read(head, 0, 4, 0).finally(() => handle.close());
    res.type(head.readUInt32BE(0) === 0x89504e47 ? "png" : "jpeg");
    res.sendFile(file);
  }));

  // --- sound effects (public) -------------------------------------------

  /** One sound of the library (audio.ts): the live preview loads a film's sfx/<id>.mp3 from here. */
  router.get("/audio/sfx/:file", handle(async (req, res) => {
    const file = path.basename(String(req.params.file));
    if (!file.endsWith(".mp3")) throw new HttpError(404, "No such sound.");
    const full = path.join(AUDIO_DIR, "sfx", file);
    try {
      await fs.access(full);
    } catch {
      throw new HttpError(404, "No such sound.");
    }
    res.set({ "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" });
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(full);
  }));

  // --- render / export --------------------------------------------------

  router.post("/projects/:projectId/render", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    // a film from the retired scene studio has no source to render; its earlier export still downloads
    assertFilmAgent(project);
    if (project.stage !== "ready") throw new HttpError(409, "The video is not ready yet.");
    // a film renders from its workspace: not while a change is being made to it
    if (isBusy(id)) throw new HttpError(409, "The film is still being worked on. Export it once it's done.");
    if (isRendering(id)) throw new HttpError(409, "A render is already running.");
    // exports cost no tokens but hold the shared renderer: out-of-budget accounts wait, one export per user
    await assertQuota(accountOf(res), "tokens");
    await assertCapacity(accountOf(res), "render");
    // included in the video, at the one quality the film was made at
    detach(runRender(id));
    res.status(202).json({ ok: true });
  }));

  router.get("/projects/:projectId/download", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    // a shared download link dies with the project's delete (signed asset links keep serving admins' previews)
    if (project.deletedAt && res.locals.signed === id) throw new HttpError(404, "Project not found.");
    const file = renderFile(id);
    const present = () => fs.access(file).then(() => true, () => false);
    // This disk is a cache: after a restart or on a new server, bring the stored export back.
    if (!(await present()) && project.render.state === "done" && project.render.stored) {
      await restoreRender(project.render.stored, file);
    }
    if (!(await present())) {
      if (project.render.state === "done") {
        await updateProject(id, (p) => {
          p.render = { state: "idle", progress: 0 };
        });
      }
      throw new HttpError(404, "This export is no longer available. Export the video again.");
    }
    const name = `${project.title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || "video"}.mp4`;
    res.download(file, name);
  }));

  /** A link to the finished export that works without a session, for 24 hours. */
  router.get("/projects/:projectId/download-url", handle(async (req, res) => {
    const id = idOf(req);
    const project = await getProject(id);
    if (project.render.state !== "done") throw new HttpError(409, "Export the video first.");
    const { query, expiresAt } = downloadToken(id);
    res.set("Cache-Control", "no-store");
    res.json({ url: `${config.appOrigin}/api/projects/${id}/download?${query}`, expiresAt });
  }));

  router.use((req, res) => {
    res.status(404).json({ error: `No API route for ${req.method} /api${req.path}` });
  });

  app.use("/api", router);

  app.use(
    "/api",
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) return next(error);

      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message, ...error.details });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid request: " + error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "),
        });
        return;
      }
      if (error instanceof UpstreamError || error instanceof InferenceError) {
        res.status(502).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError && "body" in (error as { body?: unknown })) {
        res.status(400).json({ error: "Request body is not valid JSON." });
        return;
      }
      console.error("[api] unhandled error:", error);
      res.status(500).json({ error: "Something went wrong on our side. Please try again." });
    }
  );
}
