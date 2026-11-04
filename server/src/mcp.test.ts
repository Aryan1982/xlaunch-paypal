import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { buildServer, type Rest, type RestResult } from "./mcp";

/**
 * The MCP server through the real MCP client, over its real HTTP handler, with
 * the REST API replaced by a recorder: checks the protocol, the tool list, and
 * that each tool calls the right API route and reads its answer correctly.
 */

type Call = { method: string; path: string; body?: unknown };

const connect = async (answer: (c: Call) => RestResult) => {
  const calls: Call[] = [];
  const rest: Rest = async (method, path, body) => {
    const call = { method, path, ...(body !== undefined ? { body } : {}) };
    calls.push(call);
    return answer(call);
  };
  const handler = createMcpHandler(() => buildServer(rest), { legacy: "stateless" });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://xlaunch.test/api/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    })
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: result.content.map((c) => c.text).join("\n"), isError: !!result.isError };
  };
  return { client, calls, call };
};

const project = {
  id: "abc123",
  title: "Acme",
  url: "https://acme.test/",
  stage: "ready",
  version: 2,
  scenes: [{}, {}, {}],
  render: { state: "idle", progress: 0 },
  charge: { credits: 570, state: "delivered" },
};

describe("XLaunch MCP server", () => {
  it("offers the thirteen tools, each with a description", async () => {
    const { client } = await connect(() => ({ status: 200, body: {} }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "buy_credits",
        "check_purchase",
        "confirm_brief",
        "confirm_revision",
        "create_video",
        "export_video",
        "finish_preview",
        "get_credits",
        "get_download_url",
        "get_video_status",
        "list_videos",
        "revise_video",
        "stop_video",
      ].sort()
    );
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(40);
  });

  it("create_video posts the prompt and returns the projectId and how to follow it", async () => {
    const { calls, call } = await connect(() => ({ status: 201, body: { ...project, stage: "created", charge: { credits: 570, state: "held" } } }));
    const out = await call("create_video", { prompt: "A video for https://acme.test" });
    expect(calls).toEqual([{ method: "POST", path: "/projects", body: { prompt: "A video for https://acme.test", narration: true, mode: "2d" } }]);
    expect(out.isError).toBe(false);
    expect(out.text).toContain('"projectId": "abc123"');
    expect(out.text).toContain('"held": 570');
    expect(out.text).toMatch(/about 60 seconds/);
  });

  it("create_video makes 2D only: a 3D request still asks the API for 2D, and the tool offers no style", async () => {
    const { client, calls, call } = await connect(() => ({ status: 201, body: { ...project, stage: "created", options: { aspect: "9:16" } } }));
    const out = await call("create_video", { prompt: "A video for https://acme.test", aspect: "9:16", style: "3d" });
    expect(calls[0].body).toEqual({ prompt: "A video for https://acme.test", narration: true, mode: "2d", aspect: "9:16" });
    expect(out.text).toContain('"aspect": "9:16"');
    const create = (await client.listTools()).tools.find((t) => t.name === "create_video")!;
    expect(Object.keys((create.inputSchema as { properties: Record<string, unknown> }).properties)).not.toContain("style");
  });

  it("create_video turns narration off and picks a model when asked", async () => {
    const { calls, call } = await connect(() => ({ status: 201, body: { ...project, stage: "created" } }));
    await call("create_video", { prompt: "A video for https://acme.test", narration: false, model: "claude-opus-5-5" });
    expect(calls[0].body).toMatchObject({ narration: false, model: "claude-opus-5-5" });
  });

  it("turns running out of credits into an error that says where to buy more", async () => {
    const { call } = await connect(() => ({ status: 402, body: { error: "This needs 570 credits and you have 0.", code: "credits" } }));
    const out = await call("create_video", { prompt: "https://acme.test" });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/needs 570 credits/);
    expect(out.text).toMatch(/\/billing/);
  });

  it("get_video_status reads the project and says what to do next at each stage", async () => {
    let stage = "coding";
    let render = { state: "idle", progress: 0 };
    const { calls, call } = await connect(() => ({ status: 200, body: { ...project, stage, render } }));
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/Still working/);
    expect(calls[0]).toEqual({ method: "GET", path: "/projects/abc123" });
    stage = "ready";
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/export_video/);
    render = { state: "done", progress: 1 };
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/get_download_url/);
    stage = "error";
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/refunded/);
  });

  it("tells the agent to stop polling a free preview, which waits for the user to pay", async () => {
    const { call } = await connect(() => ({ status: 200, body: { ...project, stage: "preview", charge: undefined } }));
    const out = await call("get_video_status", { project_id: "abc123" });
    expect(out.text).not.toMatch(/Still working/);
    expect(out.text).toMatch(/free preview/);
    expect(out.text).toMatch(/\/p\/abc123/);
    expect(out.text).toMatch(/stop polling/);
  });

  it("escapes the project id in paths", async () => {
    const { calls, call } = await connect(() => ({ status: 404, body: { error: "Project not found." } }));
    await call("get_video_status", { project_id: "../billing" });
    expect(calls[0]?.path).toBe("/projects/..%2Fbilling");
  });

  it("maps revise, export, confirm, download and list onto their routes", async () => {
    const { calls, call } = await connect((c) =>
      c.path.endsWith("/download-url")
        ? { status: 200, body: { url: "https://app.xlaunch.test/api/projects/abc123/download?exp=1&sig=x", expiresAt: 1_800_000_000_000 } }
        : c.path.startsWith("/projects?")
          ? { status: 200, body: { projects: [], hasMore: false } }
          : { status: 202, body: { ok: true } }
    );
    await call("revise_video", { project_id: "abc123", instruction: "shorter intro" });
    await call("export_video", { project_id: "abc123" });
    await call("confirm_brief", { project_id: "abc123" });
    const link = await call("get_download_url", { project_id: "abc123" });
    await call("list_videos", { limit: 5 });
    expect(calls).toEqual([
      { method: "POST", path: "/projects/abc123/chat", body: { message: "shorter intro" } },
      { method: "POST", path: "/projects/abc123/render", body: {} },
      { method: "POST", path: "/projects/abc123/brief", body: {} },
      { method: "GET", path: "/projects/abc123/download-url" },
      { method: "GET", path: "/projects?offset=0&limit=5" },
    ]);
    expect(link.text).toContain("download?exp=1&sig=x");
  });

  it("shows a change waiting for its price to be approved, and approves or drops it", async () => {
    const { calls, call } = await connect((c) =>
      c.method === "GET"
        ? {
            status: 200,
            body: {
              ...project,
              pendingChange: { credits: 340, estimate: 136, summary: "rebuilds the whole video" },
              chat: [{ role: "assistant", text: "This change rebuilds the whole video, which costs 340 credits. Confirm to go ahead." }],
            },
          }
        : { status: c.path.endsWith("/confirm") ? 202 : 200, body: { ok: true } }
    );
    const status = await call("get_video_status", { project_id: "abc123" });
    expect(status.text).toContain('"atMost": 340');
    expect(status.text).toContain('"estimate": 136');
    expect(status.text).toMatch(/confirm_revision/);
    await call("confirm_revision", { project_id: "abc123", confirm: true });
    await call("confirm_revision", { project_id: "abc123", confirm: false });
    expect(calls.slice(1)).toEqual([
      { method: "POST", path: "/projects/abc123/chat/confirm", body: {} },
      { method: "POST", path: "/projects/abc123/chat/cancel", body: {} },
    ]);
  });

  it("stops a video, and explains a stopped video or export", async () => {
    let body: Record<string, unknown> = { ...project, stage: "error", stopped: true };
    const { calls, call } = await connect((c) => (c.method === "GET" ? { status: 200, body } : { status: 202, body: { ok: true } }));
    expect((await call("stop_video", { project_id: "abc123" })).text).toMatch(/Stopping/);
    expect(calls[0]).toEqual({ method: "POST", path: "/projects/abc123/stop", body: {} });
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/charged for what it used/);
    body = { ...project, render: { state: "idle", progress: 0, stopped: true } };
    expect((await call("get_video_status", { project_id: "abc123" })).text).toMatch(/export was stopped/);
  });

  it("get_credits reports the balance, or that payments are off", async () => {
    let enabled = true;
    const { call } = await connect(() => ({ status: 200, body: { enabled, balance: { total: 3330 }, costs: { chat: 120 } } }));
    expect((await call("get_credits")).text).toContain('"balance": 3330');
    enabled = false;
    expect((await call("get_credits")).text).toMatch(/Payments aren't switched on/);
  });

  it("an agent buys a pack for a free preview: a link for the user, then the purchase checked, then the preview finished", async () => {
    let state = "pending";
    const { calls, call } = await connect((c) => {
      if (c.path === "/billing/checkout") return { status: 200, body: { url: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", orderId: "5O190127TN364715T" } };
      if (c.path.startsWith("/billing/checkout-status")) return { status: 200, body: { state, credited: state === "paid", sku: "pack_one", balance: state === "paid" ? 550 : 0 } };
      return { status: 202, body: { ok: true } };
    });
    const bought = await call("buy_credits", { sku: "pack_one", project_id: "abc123" });
    expect(bought.text).toContain("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T");
    // the agent can't pay: it hands the link over and checks this order afterwards
    expect(bought.text).toMatch(/Only they can approve/);
    expect(bought.text).toContain('order_id "5O190127TN364715T"');
    expect((await call("check_purchase", { order_id: "5O190127TN364715T" })).text).toMatch(/Not paid yet/);
    state = "paid";
    expect((await call("check_purchase", { order_id: "5O190127TN364715T" })).text).toMatch(/finish_preview/);
    expect((await call("finish_preview", { project_id: "abc123" })).text).toMatch(/Building the full video/);
    expect(calls).toEqual([
      { method: "POST", path: "/billing/checkout", body: { sku: "pack_one", projectId: "abc123" } },
      { method: "GET", path: "/billing/checkout-status?order_id=5O190127TN364715T" },
      { method: "GET", path: "/billing/checkout-status?order_id=5O190127TN364715T" },
      { method: "POST", path: "/projects/abc123/build", body: {} },
    ]);
  });

  it("finish_preview on a preview the user's browser already finished is not an error", async () => {
    const { call } = await connect(() => ({ status: 409, body: { error: "This video is already paid for." } }));
    const out = await call("finish_preview", { project_id: "abc123" });
    expect(out.isError).toBe(false);
    expect(out.text).toMatch(/already being finished/);
  });
});
