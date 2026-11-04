import DodoPayments from "dodopayments";
import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";

/**
 * The webhook route hands the SDK the raw body as a string and the three
 * Standard Webhooks headers. This proves that exact path verifies a payload
 * signed the way Dodo signs it, and refuses anything altered.
 */

const SECRET = `whsec_${Buffer.from("a-test-signing-key-of-32-bytes!!").toString("base64")}`;
const client = new DodoPayments({ bearerToken: "unused", webhookKey: SECRET, environment: "test_mode" });

const signed = (body: string, id = "msg_1", at = new Date()) => ({
  "webhook-id": id,
  "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
  "webhook-signature": new Webhook(SECRET).sign(id, at, body),
});

const event = JSON.stringify({
  business_id: "bus_1",
  type: "payment.succeeded",
  timestamp: new Date().toISOString(),
  data: { payload_type: "Payment", payment_id: "pay_1", metadata: { user_id: "u1" } },
});

describe("webhook signature", () => {
  it("accepts the raw body exactly as Dodo signed it", () => {
    const out = client.webhooks.unwrap(event, { headers: signed(event) }) as unknown as { type: string; data: { payment_id: string } };
    expect(out.type).toBe("payment.succeeded");
    expect(out.data.payment_id).toBe("pay_1");
  });

  it("refuses a body that was re-serialised or altered after signing", () => {
    const headers = signed(event);
    const reformatted = JSON.stringify(JSON.parse(event), null, 2);
    expect(() => client.webhooks.unwrap(reformatted, { headers })).toThrow();
    expect(() => client.webhooks.unwrap(event.replace("pay_1", "pay_2"), { headers })).toThrow();
  });

  it("refuses a signature made with another key, and a stale timestamp", () => {
    const other = new Webhook(`whsec_${Buffer.from("another-key-entirely-32-bytes!!!").toString("base64")}`);
    const at = new Date();
    expect(() =>
      client.webhooks.unwrap(event, {
        headers: { "webhook-id": "msg_1", "webhook-timestamp": String(Math.floor(at.getTime() / 1000)), "webhook-signature": other.sign("msg_1", at, event) },
      })
    ).toThrow();
    const old = new Date(Date.now() - 60 * 60 * 1000);
    expect(() => client.webhooks.unwrap(event, { headers: signed(event, "msg_1", old) })).toThrow();
  });
});
