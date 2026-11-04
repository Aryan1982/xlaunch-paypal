import { z } from "zod";

import { db, must } from "../db";
import { productBySku } from "./catalog";
import { balanceOf } from "./credits";

/**
 * An account's credit history, newest first, for the Credits page: every
 * purchase, video charge and refund on the ledger, with the balance after
 * each and the video it was for.
 */

export type ActivityKind = "purchase" | "spend" | "refund" | "adjust";

export type ActivityRow = {
  id: number;
  at: string;
  kind: ActivityKind;
  /** Signed: + added, - taken. */
  credits: number;
  /** The balance right after this change. */
  balance: number;
  description: string;
  projectId: string | null;
  projectTitle: string | null;
  /** The PayPal order that paid for a purchase. */
  paypalOrderId: string | null;
};

const LedgerRow = z.object({
  id: z.number(),
  at: z.string(),
  kind: z.enum(["grant", "spend", "refund", "adjust"]),
  sub_delta: z.number(),
  pack_delta: z.number(),
  reason: z.string(),
  project_id: z.string().nullable(),
  dodo_ref: z.string().nullable(),
});
type LedgerRow = z.infer<typeof LedgerRow>;

const KIND: Record<LedgerRow["kind"], ActivityKind> = { grant: "purchase", spend: "spend", refund: "refund", adjust: "adjust" };

/** A ledger reason as people read it: "pack_pro" → "Pro pack", "video" → "Video", a revoked purchase → "PayPal refund". */
const describe = (row: LedgerRow): string => {
  if (row.kind === "grant") {
    const names = row.reason.split("+").map((sku) => productBySku(sku)?.name ?? sku);
    return names.join(" + ");
  }
  if (isPurchaseRefund(row)) return "PayPal refund";
  const text = row.reason.trim();
  return text ? text[0].toUpperCase() + text.slice(1) : row.kind;
};

/** credit_revoke books a refunded purchase as an adjustment whose reason is "refund <PayPal refund id>". */
const isPurchaseRefund = (row: LedgerRow): boolean => row.kind === "adjust" && /^refund /.test(row.reason);

/**
 * Rows newest first, each with the balance right after it: walked back from
 * the balance now (the ledger is the only way credits move).
 */
export const toActivity = (rows: LedgerRow[], balanceNow: number, titles: Map<string, string>): ActivityRow[] => {
  let after = balanceNow;
  return rows.map((row) => {
    const credits = row.sub_delta + row.pack_delta;
    const out: ActivityRow = {
      id: row.id,
      at: row.at,
      kind: isPurchaseRefund(row) ? "refund" : KIND[row.kind],
      credits,
      balance: after,
      description: describe(row),
      projectId: row.project_id,
      projectTitle: row.project_id ? (titles.get(row.project_id) ?? null) : null,
      paypalOrderId: row.dodo_ref?.startsWith("paypal:") ? row.dodo_ref.slice("paypal:".length) : null,
    };
    after -= credits;
    return out;
  });
};

export const ACTIVITY_LIMIT = 500;

export const activityOf = async (userId: string): Promise<ActivityRow[]> => {
  const rows = z
    .array(LedgerRow)
    .parse(
      must(
        await db()
          .from("credit_ledger")
          .select("id, at, kind, sub_delta, pack_delta, reason, project_id, dodo_ref")
          .eq("user_id", userId)
          .order("at", { ascending: false })
          .order("id", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        "credit activity"
      )
    );
  const ids = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => !!id))];
  const titles = new Map<string, string>();
  if (ids.length) {
    const projects = z
      .array(z.object({ id: z.string(), title: z.string() }))
      .parse(must(await db().from("projects").select("id, title").eq("user_id", userId).in("id", ids), "activity titles"));
    for (const p of projects) titles.set(p.id, p.title);
  }
  return toActivity(rows, (await balanceOf(userId)).total, titles);
};
