/**
 * Connect to a running XLaunch MCP server the way Claude does and call only
 * the read-only tools (no video is made, no model is called, no credits move).
 *
 *   XLAUNCH_API_KEY=xl_... npx tsx scripts/mcp/smoke.ts [http://127.0.0.1:3001/api/mcp]
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:3001/api/mcp");
const key = process.env.XLAUNCH_API_KEY;
if (!key) throw new Error("Set XLAUNCH_API_KEY.");

async function main() {
  const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  console.log(`without a key: ${unauthorized.status} (${unauthorized.headers.get("www-authenticate") ?? "no WWW-Authenticate"})`);

  const client = new Client({ name: "xlaunch-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

  for (const [name, args] of [
    ["get_credits", {}],
    ["list_videos", { limit: 3 }],
  ] as const) {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    console.log(`\n${name}${result.isError ? " (error)" : ""}:\n${result.content.map((c) => c.text).join("\n").slice(0, 800)}`);
  }
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
