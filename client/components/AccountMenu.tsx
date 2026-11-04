"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Coins, KeyRound, LogOut, Plus } from "lucide-react";

import { Skeleton, cn } from "@/components/ui";
import { clearAccount, loadAccount, useAccount } from "@/lib/account";
import { useSession } from "@/lib/use-signed-in";
import { loginHref } from "@/lib/funnel";
import { typicalVideo } from "@/lib/pricing";
import { authEnabled, supabaseBrowser } from "@/lib/supabase/browser";

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const num = (n: number) => n.toLocaleString("en-US");

const Meter = ({ label, used, limit, format = String }: { label: string; used: number; limit: number; format?: (n: number) => string }) => {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-mute">{label}</span>
        <span className="tabular-nums">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full rounded-full", share >= 0.9 ? "bg-bad" : "bg-accent")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
};

const ring = (onHero?: boolean) =>
  onHero ? "border-white/25 text-[color:var(--hero-fg)] hover:bg-white/10" : "border-line-hi text-fg hover:bg-panel-hi";

/** Signed in: the account menu. Signed out (public pages): a sign-in link. While checking: a placeholder the same size. */
export function AccountMenu({ onHero }: { onHero?: boolean }) {
  const { signedIn, email } = useSession();
  // back to this page after signing in
  const here = usePathname();
  if (!authEnabled() && signedIn) return <Menu onHero={onHero} sessionEmail={null} />;
  if (signedIn === null) return <Skeleton className="size-8 rounded-full" />;
  if (!signedIn) {
    return (
      <Link href={loginHref("header", here ?? undefined)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", ring(onHero))}>
        Sign in
      </Link>
    );
  }
  return <Menu onHero={onHero} sessionEmail={email} />;
}

/** The signed-in account: credits (or this month's allowance), shortcuts and sign out. */
function Menu({ onHero, sessionEmail }: { onHero?: boolean; sessionEmail: string | null }) {
  const { me, billing } = useAccount();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const email = sessionEmail ?? me?.email ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    // what's shown is the kept copy; bring it up to date behind it
    void loadAccount(true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!email) return <Skeleton className="size-8 rounded-full" />;

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    clearAccount();
    router.replace(loginHref("signout"));
  };

  // low: not enough for one video even with the cheapest model
  const typical = billing ? typicalVideo(billing.costs).cheapest : 0;
  const low = !!billing?.enabled && typical > 0 && billing.balance.total < typical;

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account"
        className={cn("relative grid size-8 cursor-pointer place-items-center rounded-full border text-xs font-medium uppercase transition-colors", ring(onHero))}
      >
        {email.slice(0, 1)}
        {low && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-bg bg-warn" aria-hidden />}
      </button>
      {open && (
        <div
          role="menu"
          className="animate-pop absolute right-0 top-10 z-50 w-72 rounded-xl border border-line bg-panel p-1.5 text-left text-fg shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]"
        >
          <div className="px-2.5 pb-2 pt-2">
            <div className="truncate text-sm font-medium">{email}</div>
            {/* with payments on, credits say it all; before that, the account's plan */}
            {me === undefined ? (
              <Skeleton className="mt-1.5 h-3 w-16" />
            ) : me?.isAdmin ? (
              <div className="mt-0.5 text-xs text-dim">Admin</div>
            ) : me && billing && !billing.enabled ? (
              <div className="mt-0.5 text-xs text-dim first-letter:uppercase">{me.plan} plan</div>
            ) : null}
          </div>

          <div className="px-1">
            {billing === undefined ? (
              <Skeleton className="h-[92px] rounded-lg" />
            ) : billing?.enabled ? (
              <div className={cn("rounded-lg border px-3 py-2.5", low ? "border-warn/40 bg-warn/5" : "border-line")}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-mute">
                    <Coins className="size-3.5" /> Credits
                  </span>
                  <Link
                    href="/billing"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
                  >
                    <Plus className="size-3" /> {low ? "Top up" : "Buy"}
                  </Link>
                </div>
                <div className="mt-1 text-2xl font-medium tabular-nums tracking-tight">{num(billing.balance.total)}</div>
                <div className="text-xs text-dim">
                  {billing.balance.total >= typical && typical > 0
                    ? `About ${num(Math.floor(billing.balance.total / typical))} videos`
                    : `A video usually takes about ${num(typical)} credits`}
                </div>
              </div>
            ) : me?.usage && !me.isAdmin ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line px-3 py-3">
                <Meter label="Videos this month" used={me.usage.videos} limit={me.limits.videos} />
                <Meter label="Generation budget" used={me.usage.tokens} limit={me.limits.tokens} format={compact} />
                <Meter label="Storage" used={Math.round(me.usage.storedBytes / 1024 / 1024)} limit={me.limits.storageMb} format={(n) => `${n} MB`} />
              </div>
            ) : billing === null && !me?.isAdmin ? (
              <button
                onClick={() => void loadAccount(true)}
                className="w-full cursor-pointer rounded-lg border border-line px-3 py-2.5 text-left text-xs text-mute hover:bg-panel-hi"
              >
                Couldn&apos;t load your credits. <span className="text-accent">Try again</span>
              </button>
            ) : null}
            {me?.usage && me.isAdmin && (
              <div className="mt-2 px-1.5 text-xs text-mute">
                This month: {me.usage.videos} videos · {compact(me.usage.tokens)} tokens · ${me.usage.costUsd.toFixed(2)}
              </div>
            )}
          </div>

          <div className="mt-1.5 border-t border-line pt-1.5">
            {billing?.enabled && (
              <MenuLink href="/billing" onClick={() => setOpen(false)} icon={<ArrowUpRight className="size-4" />}>
                Credits and billing
              </MenuLink>
            )}
            <MenuLink href="/billing#api-keys" onClick={() => setOpen(false)} icon={<KeyRound className="size-4" />}>
              API keys for Claude
            </MenuLink>
            <button
              role="menuitem"
              onClick={signOut}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-mute hover:bg-panel-hi hover:text-fg"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const MenuLink = ({ href, onClick, icon, children }: { href: string; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) => (
  <Link
    role="menuitem"
    href={href}
    onClick={onClick}
    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-mute hover:bg-panel-hi hover:text-fg"
  >
    {icon}
    {children}
  </Link>
);
