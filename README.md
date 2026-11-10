# XLaunch — AI launch videos, paid for with PayPal

Paste a product's URL and get a custom motion-graphics launch video. No templates: an AI agent researches the
product, plans the film, writes it from scratch as Remotion (React) code, watches its own frames, and revises it. A
free preview shows the plan and the opening; the full film is paid for with **PayPal**, on the web or by an
**AI agent** over MCP, with the human approving the payment in PayPal.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Payments run in the **PayPal sandbox**:
no real money moves.

- Live demo: https://xlaunch-paypal.vercel.app (API: https://paypal-api.xlaunch.pro)
- Video: https://youtu.be/E4zNi4C2Kzc
- Sandbox test buyer for the demo: in the Devpost submission's testing instructions

## How PayPal is used

| Where | PayPal | Code |
| --- | --- | --- |
| Credits page | PayPal JS SDK buttons (PayPal, Pay Later, Venmo for US buyers; cards inside PayPal's window) | `client/components/PayPalButtons.tsx`, `client/app/billing/page.tsx` |
| Paywall and home page | Redirect to PayPal's approval page, back to the video | `client/components/project/Paywall.tsx`, `client/components/CheckoutResult.tsx` |
| Orders | **Orders v2**: the server creates each order (amount from the catalog, buyer in `custom_id`) and captures it | `server/src/billing/paypal.ts` |
| Webhooks | `CHECKOUT.ORDER.APPROVED` (capture, for a buyer who never comes back), `PAYMENT.CAPTURE.COMPLETED` (grant), `PAYMENT.CAPTURE.REFUNDED` (a full refund takes the credits back), each verified with `verify-webhook-signature` | `server/src/billing/paypal.ts`, `server/src/api.ts` |
| Agentic commerce | MCP tools: `buy_credits` returns a PayPal approval link the agent hands its user (it can't approve for them), `check_purchase` captures once approved, `finish_preview` finishes the video | `server/src/mcp.ts` |

Credits are granted once per order (`grant:paypal:<order id>`) whichever path gets there first, and only when PayPal
took the pack's full price in USD. Capturing twice is safe (one PayPal-Request-Id per order).

## How AI is used

- **Film agent**: one Claude session per video (Claude Agent SDK) in its own Remotion workspace: it writes
  `PLAN.md`, the scenes as React code, renders stills to look at its own frames, revises, and checks the result
  (`server/src/pipeline/motion-agent.ts`, `server/motion-studio/`). A customer's session has no shell: its file tools
  stay inside its workspace and the studio's commands run as server-side tools.
- **Research**: an LLM reads the product's public pages (fetched through a public-address guard) and writes the brief
  (`server/src/pipeline/motion-context.ts`).
- **Narration**: ElevenLabs `eleven_v3` records the voice-over the agent writes; captions are timed to the measured
  word starts.
- **MCP server** (`/api/mcp`, OAuth or API key): Claude and other agents make, change, export and pay for videos.

## Sponsor tools

- **AG Grid + AG Charts** (Community): the Credits page's **Activity**. AG Charts draws the balance over time (each
  PayPal purchase a step up, each video a step down, refunds back); AG Grid lists every purchase, video charge and
  refund with its PayPal order id, balance after, search, type filters, sorting and CSV export. Both are themed from the
  site's CSS variables, so they follow the light/dark switch, and load only on that page.
  `client/components/billing/CreditActivity.tsx`, backed by `GET /api/billing/activity` (`server/src/billing/activity.ts`).
- **Postman**: [`postman/`](postman) has a collection and an environment for the demo: the price list, balance and
  activity, the PayPal checkout (create an order, approve it in a browser, check it, which captures it), videos, and
  the MCP tools an agent buys credits with. Every request has tests. Import both into Postman, set `apiKey` (make one on
  the Credits page), or run it from a terminal:

  ```bash
  npx newman run postman/XLaunch.postman_collection.json -e postman/XLaunch-demo.postman_environment.json --env-var apiKey=xl_...
  ```

## Run it

Needs Node 26 (what it's run on), a Supabase project, a PayPal sandbox app, and an Anthropic API key.

```bash
# 1. Database: a Supabase project; apply the schema
cd server
npm install
DATABASE_URL=postgresql://... npx tsx scripts/db/migrate.ts --apply

# 2. API (port 3001)
cp .env.example .env
#   SUPABASE_URL, SUPABASE_SECRET_KEY, CLAUDE_API_KEY, OPENCODE_API_KEY (research model), ELEVENLABS_KEY (narration),
#   PAYMENT_PROVIDER=paypal, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID (see "PayPal sandbox" below)
npm run motion:setup        # the film agent's Remotion template and its browser
npm run dev

# 3. Web app (port 3100)
cd ../client
cp .env.example .env.local  # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, API_ORIGIN=http://127.0.0.1:3001
npm install
npm run dev
```

Open http://localhost:3100, sign in, paste a product URL and press Generate.

### PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox), create a REST app
   (Merchant) and copy its client id and secret into `server/.env`.
2. Add a webhook to the app: `https://<your API>/api/billing/paypal/webhook`, events `CHECKOUT.ORDER.APPROVED`,
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`. Put its id in `PAYPAL_WEBHOOK_ID`. Without it, the
   buyer's page still completes payments; webhooks add the cases where the buyer never comes back, and refunds.
3. Pay with a sandbox **personal** account (Testing Tools → Sandbox Accounts).

`PAYPAL_ENVIRONMENT` defaults to `sandbox`.

### Tests

```bash
cd server && npm test && npm run typecheck
```

## Layout

| Path | What |
| --- | --- |
| `server/src/billing/` | credits, the catalog, PayPal (`paypal.ts`), the provider switch (`checkout.ts`), credit activity (`activity.ts`) |
| `server/src/pipeline/` | research, the film agent, narration, rendering |
| `server/src/mcp.ts` | the MCP server, including the purchase tools |
| `server/motion-studio/` | the film agent's Remotion template and its motion-design skill |
| `client/` | the Next.js web app (deployed on Vercel); `/api` is proxied to the server by `proxy.ts` |
| `postman/` | the Postman collection and environment for the demo's API and MCP server |

## License

[AGPL-3.0](LICENSE), including the sound effects in `server/assets/audio` (original recordings). Running a modified
version as a service means publishing its source.

"XLaunch" and its logo are not covered by the license: a copy or fork must use its own name.
