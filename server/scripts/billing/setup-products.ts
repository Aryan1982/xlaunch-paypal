/**
 * Create XLaunch's products in Dodo Payments and print the DODO_PRODUCTS line.
 *
 *   npx tsx scripts/billing/setup-products.ts            # create what's missing
 *   npx tsx scripts/billing/setup-products.ts --dry-run  # only report
 *
 * Uses DODO_PAYMENTS_API_KEY and DODO_ENVIRONMENT (test_mode by default), so
 * the same command sets up test mode and, with the live key, live mode. Safe
 * to run again: a product is found by the SKU stored in its metadata and only
 * created when missing. Prices of existing products are never changed here
 * (change them in the Dodo dashboard); a mismatch is reported.
 */
import "../../src/config";
import DodoPayments from "dodopayments";

import { PRODUCTS, type Product } from "../../src/billing/catalog";
import { dodoEnvironment } from "../../src/billing/dodo";

const dryRun = process.argv.includes("--dry-run");

const apiKey = process.env.DODO_PAYMENTS_API_KEY;
if (!apiKey) {
  console.error("Set DODO_PAYMENTS_API_KEY (and DODO_ENVIRONMENT=test_mode or live_mode) in server/.env first.");
  process.exit(1);
}

const environment = dodoEnvironment();
const client = new DodoPayments({ bearerToken: apiKey, environment });

const priceFor = (product: Product) =>
  product.kind === "pack"
    ? { type: "one_time_price" as const, price: product.priceCents, currency: "USD" as const, discount: 0, purchasing_power_parity: false }
    : {
        type: "recurring_price" as const,
        price: product.priceCents,
        currency: "USD" as const,
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_count: 1,
        payment_frequency_interval: product.interval === "month" ? ("Month" as const) : ("Year" as const),
        // how long the subscription runs before it needs renewing by hand: effectively open-ended
        subscription_period_count: 10,
        subscription_period_interval: "Year" as const,
      };

const describe = (product: Product): string =>
  product.kind === "pack"
    ? `${product.credits.toLocaleString("en-US")} credits that never expire.`
    : `${product.credits.toLocaleString("en-US")} credits each ${product.interval}; unused credits roll over.`;

async function main() {
  console.log(`Dodo ${environment}${dryRun ? " (dry run)" : ""}\n`);

  const existing = new Map<string, { id: string; price: number | null | undefined }>();
  for await (const p of client.products.list({ archived: false })) {
    const sku = typeof p.metadata?.sku === "string" ? p.metadata.sku : undefined;
    if (sku && !existing.has(sku)) existing.set(sku, { id: p.product_id, price: p.price });
  }

  const ids: Record<string, string> = {};
  for (const product of PRODUCTS) {
    const found = existing.get(product.sku);
    if (found) {
      ids[product.sku] = found.id;
      const note = found.price != null && found.price !== product.priceCents ? `  ⚠ price in Dodo is ${found.price}, catalog says ${product.priceCents}` : "";
      console.log(`  exists   ${product.sku.padEnd(18)} ${found.id}${note}`);
      continue;
    }
    if (dryRun) {
      console.log(`  missing  ${product.sku.padEnd(18)} would create "${product.name}" at $${(product.priceCents / 100).toFixed(2)}`);
      continue;
    }
    const created = await client.products.create({
      name: `XLaunch ${product.name}`,
      description: describe(product),
      tax_category: "saas",
      price: priceFor(product),
      metadata: { sku: product.sku },
    });
    ids[product.sku] = created.product_id;
    console.log(`  created  ${product.sku.padEnd(18)} ${created.product_id}`);
  }

  if (Object.keys(ids).length === 0) return;
  console.log(`\nAdd to server/.env (${environment}):\n`);
  console.log(`DODO_PRODUCTS='${JSON.stringify(ids)}'`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
