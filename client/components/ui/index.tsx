"use client";

import React from "react";

export const cn = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, className, children, ...rest },
  ref
) {
  const variants = {
    primary:
      "bg-fg text-bg hover:bg-fg/85",
    // the page's one call to action: the accent, with its glow
    accent: "bg-accent text-white shadow-[0_12px_30px_-12px_var(--accent)] hover:bg-accent-hi",
    secondary: "bg-panel text-fg border border-line-hi hover:bg-panel-hi",
    ghost: "text-mute hover:text-fg hover:bg-panel-hi",
    danger: "bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20",
  };
  const sizes = {
    sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
    md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
    lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
  };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer select-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const Card = ({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-xl border border-line bg-panel", className)} {...rest}>
    {children}
  </div>
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-line-hi bg-bg px-3 text-sm text-fg placeholder:text-dim outline-none transition-colors focus:border-accent",
        className
      )}
      {...rest}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-line-hi bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim outline-none transition-colors focus:border-accent resize-none",
        className
      )}
      {...rest}
    />
  );
});

export const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("mb-1.5 text-xs font-medium text-mute", className)}>
    {children}
  </div>
);

export const Badge = ({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "accent" | "ok" | "warn" | "bad";
  children: React.ReactNode;
  className?: string;
}) => {
  const tones = {
    neutral: "bg-panel-hi text-mute border-line-hi",
    accent: "bg-accent/15 text-accent-hi border-accent/30",
    ok: "bg-ok/10 text-ok border-ok/25",
    warn: "bg-warn/10 text-warn border-warn/25",
    bad: "bg-bad/10 text-bad border-bad/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
};

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("skeleton rounded-lg", className)} />
);

export const ErrorBanner = ({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) => (
  <div
    role="alert"
    className="flex items-start justify-between gap-4 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad"
  >
    <span className="whitespace-pre-wrap break-words">{message}</span>
    {action}
  </div>
);
