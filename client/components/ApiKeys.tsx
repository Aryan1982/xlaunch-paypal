"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Button, ErrorBanner, Input } from "@/components/ui";
import { ApiError, api, type ApiKeyInfo } from "@/lib/api";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The MCP endpoint, on the origin the user is signed in to. */
const mcpUrl = () => `${process.env.NEXT_PUBLIC_APP_ORIGIN || window.location.origin}/api/mcp`;

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      className="shrink-0 cursor-pointer rounded-md p-1.5 text-mute hover:bg-panel-hi hover:text-fg"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  );
};

const Snippet = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2 rounded-lg border border-line bg-bg px-3 py-2">
    <code className="flex-1 break-all font-mono text-xs leading-relaxed text-fg">{text}</code>
    <CopyButton text={text} />
  </div>
);

/** Make, list and revoke API keys, and show how to connect Claude to XLaunch over MCP. */
export function ApiKeys({ onNeedsCredits }: { onNeedsCredits?: () => void }) {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.apiKeys().then(
        (list) => setKeys(list),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e))
      ),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    setBusy("create");
    try {
      const made = await api.createApiKey(name.trim() || "Claude");
      setFresh(made.key);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError && e.code === "credits") onNeedsCredits?.();
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (key: ApiKeyInfo) => {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working at once.`)) return;
    setError(null);
    setBusy(key.id);
    try {
      await api.revokeApiKey(key.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const command = (key: string) => `claude mcp add --transport http xlaunch ${mcpUrl()} --header "Authorization: Bearer ${key}"`;

  return (
    <section id="api-keys" className="mt-10 max-w-[720px] scroll-mt-6">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <KeyRound className="size-4" /> API &amp; MCP
      </h2>
      <p className="mt-1 text-sm text-mute">
        Let Claude (or your own scripts) make videos for you. Videos made this way use your credits, the same as in the studio.
        In claude.ai or the Claude app you don&apos;t need a key: add <span className="font-mono">{mcpUrl()}</span> as a custom
        connector and sign in. Keys are for Claude Code, other MCP clients and scripts.
      </p>

      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {fresh && (
        <div className="mt-4 rounded-2xl border border-accent/40 bg-panel p-5">
          <div className="text-sm font-medium">Your new key — copy it now, it won&apos;t be shown again</div>
          <div className="mt-3">
            <Snippet text={fresh} />
          </div>
          <div className="mt-4 text-sm text-mute">Add XLaunch to Claude Code:</div>
          <div className="mt-2">
            <Snippet text={command(fresh)} />
          </div>
          <div className="mt-3 text-xs text-dim">
            Other MCP clients: the server is <span className="font-mono">{mcpUrl()}</span> (Streamable HTTP), with the key as a bearer token.
          </div>
          <Button className="mt-4" size="sm" variant="ghost" onClick={() => setFresh(null)}>
            Done
          </Button>
        </div>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Claude Code" maxLength={60} className="max-w-[280px]" />
        <Button type="submit" size="sm" loading={busy === "create"} disabled={busy !== null}>
          Create key
        </Button>
      </form>

      {keys && keys.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel text-sm">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">{key.name}</div>
                <div className="mt-0.5 text-xs text-dim">
                  <span className="font-mono">{key.prefix}…</span> · made {date(key.createdAt)} ·{" "}
                  {key.lastUsedAt ? `last used ${date(key.lastUsedAt)}` : "never used"}
                </div>
              </div>
              <Button size="sm" variant="ghost" loading={busy === key.id} disabled={busy !== null} onClick={() => void revoke(key)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
