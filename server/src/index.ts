import express from "express";

import { config } from "./config";

// A renderer tab that dies can reject a promise nobody is awaiting any more
// ("Target closed" while Remotion closes it). Node would exit on that, taking
// every running job down with it ("The server restarted while this was
// running"): log it instead; the job that owned the tab fails on its own.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason instanceof Error ? (reason.stack ?? reason.message) : reason);
});
import { registerApi } from "./api";
import { billingEnabled, paymentProvider } from "./billing/credits";
import { dodoEnvironment } from "./billing/dodo";
import { paypalEnvironment } from "./billing/paypal";
import { settleInterrupted } from "./billing/jobs";
import { startFollowUps } from "./email/followup";
import { dbEnabled } from "./db";
import { flushProjects } from "./store";
import { flushStorageOps, storageEnabled } from "./storage";
import { flushUsage } from "./usage/ledger";
import { initUsage } from "./usage/quota";

/**
 * Without a database the server runs in local mode: no sign-in, every caller
 * an admin. That must never happen by accident in production (a missing or
 * misspelled variable), so production refuses to start instead.
 */
const assertProductionConfig = (): void => {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [
    ...(dbEnabled() ? [] : ["SUPABASE_URL / SUPABASE_SECRET_KEY"]),
    ...((process.env.ASSET_SIGNING_SECRET ?? "").length >= 32 ? [] : ["ASSET_SIGNING_SECRET (32+ characters)"]),
  ];
  if (missing.length) throw new Error(`Refusing to start in production without: ${missing.join(", ")}.`);
  // Not a safety setting, so no refusal: without it, signed download links point at the renderer's loopback address.
  if (!process.env.APP_ORIGIN) console.warn("[config] APP_ORIGIN is not set: export download links will not work outside this machine.");
};

/** XLaunch's production Supabase project (its URL is public: the web app ships it). */
const PRODUCTION_SUPABASE_REF = "gkliyuvotpjfejyiiftg";

/** Test payments on the live site, or real money taken from a dev machine: both are always a mistake. */
const warnBillingMode = (): void => {
  if (!billingEnabled()) return;
  if (paymentProvider() === "paypal") {
    // sandbox money is free: a sandbox server must never grant credits in the production database
    if (paypalEnvironment() === "sandbox" && (process.env.SUPABASE_URL ?? "").includes(PRODUCTION_SUPABASE_REF)) {
      throw new Error("PayPal sandbox against the production database: sandbox payments would grant real credits. Use the test database.");
    }
    if (!process.env.PAYPAL_WEBHOOK_ID) console.warn("[billing] PAYPAL_WEBHOOK_ID is not set: only the buyer's page adds credits (no webhooks).");
    return;
  }
  const live = dodoEnvironment() === "live_mode";
  const production = process.env.NODE_ENV === "production";
  if (production && !live) console.warn("[billing] DODO_ENVIRONMENT is test_mode in production: checkouts will not take real payments.");
  if (!production && live) console.warn("[billing] DODO_ENVIRONMENT is live_mode outside production: checkouts here take REAL money.");
  if (!process.env.DODO_PAYMENTS_WEBHOOK_KEY) console.warn("[billing] DODO_PAYMENTS_WEBHOOK_KEY is not set: payments will not add credits.");
  if (!process.env.DODO_PRODUCTS) console.warn("[billing] DODO_PRODUCTS is not set: nothing is for sale.");
};

async function main() {
  assertProductionConfig();
  warnBillingMode();
  const app = express();
  app.disable("x-powered-by");
  // No CORS: browsers reach the API only through the web app's /api proxy.
  // The asset and audio routes set their own headers for the renderer.
  registerApi(app);
  await initUsage();
  console.log(
    dbEnabled()
      ? `Accounts and projects: Supabase. Files: ${storageEnabled() ? "R2" : "this disk only (R2 not configured)"}.`
      : "No database configured: local mode (files in data/, no sign-in)."
  );

  app.listen(config.port, config.host, () => {
    console.log(`Server running at http://${config.host}:${config.port}`);
  });

  // nothing is running yet, so any video still holding credits lost its job to the last restart
  void settleInterrupted().then(
    (n) => n && console.log(`[billing] refunded ${n} video(s) interrupted by the last restart`),
    (error) => console.error("[billing] settling interrupted videos failed:", error)
  );

  // follow-up emails: a free preview left unpaid, a checkout left, a paywall left (on when RESEND_API_KEY and EMAIL_FROM are set)
  startFollowUps();

  // Write what is buffered before exiting (pm2 restart sends SIGINT).
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.allSettled([flushUsage(), flushProjects(), storageEnabled() ? flushStorageOps() : Promise.resolve()]).finally(() =>
        process.exit(0)
      );
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
