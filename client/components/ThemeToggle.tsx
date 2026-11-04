"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/components/ui";

/** Light/dark switch. The initial theme is set by the inline script in layout.tsx. */
export function ThemeToggle({ className, onHero }: { className?: string; onHero?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = next;
      setTheme(next);
    };
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage can be blocked; the switch still works for this session.
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return apply();

    // Cross-fade the whole page (backgrounds, images and text together).
    if ("startViewTransition" in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() =>
        flushSync(apply)
      );
      return;
    }

    // Fallback: ease colours for a moment, then drop the rule again.
    root.classList.add("theme-fade");
    apply();
    window.setTimeout(() => root.classList.remove("theme-fade"), 400);
  };

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className={cn(
        "grid size-8 place-items-center rounded-lg transition-colors cursor-pointer",
        onHero ? "text-[color:var(--hero-fg)] hover:bg-[color:var(--hero-fg)]/10" : "text-mute hover:bg-panel-hi hover:text-fg",
        className
      )}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
