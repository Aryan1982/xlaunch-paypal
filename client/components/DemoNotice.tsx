"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Clock, CreditCard, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui";

/**
 * A first-visit note for judges and visitors of the hackathon demo: PayPal
 * runs in the sandbox (no real money), but every video runs real AI models
 * on the builder's own API account. Shown once per browser; the "Demo info"
 * badge on the Credits page opens it again (`openDemoNotice`).
 */

const SEEN = "demo-notice-seen-v1";
const OPEN_EVENT = "xlaunch:demo-notice";

export const openDemoNotice = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Pages it never covers: the sandboxed preview frame, and the auth hand-offs. */
const QUIET = [/^\/frame/, /^\/auth\//, /^\/oauth\//, /^\/s\//];

export function DemoNotice() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const done = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (QUIET.some((re) => re.test(pathname))) return;
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN) === "1";
    } catch {
      // storage blocked: show it, it just can't be remembered
      seen = false;
    }
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    // after first paint, so it opens over the page instead of with it
    const timer = seen ? undefined : window.setTimeout(show, 600);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.clearTimeout(timer);
    };
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // nothing to remember it in
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    done.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, close]);

  if (!open) return null;

  const points = [
    {
      icon: <CreditCard className="size-4" />,
      title: "PayPal runs in the sandbox",
      body: "No real money moves. Pay with a PayPal sandbox personal account: the login is in the Devpost testing instructions, or use your own from developer.paypal.com.",
    },
    {
      icon: <Sparkles className="size-4" />,
      title: "The AI is real, and so is its bill",
      body: "Every video is made by Claude and voiced by ElevenLabs on my own API account, so each one costs me real credits even though the PayPal payment is free. Please make one or two videos, not dozens.",
    },
    {
      icon: <Clock className="size-4" />,
      title: "What to expect",
      body: "Paste a product URL: a free preview (the plan and its opening) is ready in about 10 minutes. Finish it with PayPal and the whole film takes another 10 to 20.",
    },
    {
      icon: <Bot className="size-4" />,
      title: "Worth a look",
      body: "The Credits page (PayPal buttons, and every purchase in the Activity grid), and Claude buying credits over MCP: it hands you a PayPal link, only you can approve it.",
    },
  ];

  return (
    <div className="demo-notice-backdrop fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-notice-title"
        className="demo-notice relative max-h-[calc(100svh-2rem)] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-lg text-mute transition-colors hover:bg-panel-hi hover:text-fg"
        >
          <X className="size-4" />
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffc439] px-2.5 py-0.5 text-[11px] font-semibold text-[#003087]">
          PayPal AI Hackathon · demo
        </span>
        <h2 id="demo-notice-title" className="mt-3 text-lg font-medium tracking-tight text-fg">
          Before you try it
        </h2>
        <ul className="mt-4 flex flex-col gap-3.5">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">{p.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{p.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-mute">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              close();
              router.push("/billing");
            }}
          >
            See the Credits page
          </Button>
          <Button ref={done} variant="primary" onClick={close}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
