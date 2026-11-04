"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Clapperboard, Search, type LucideIcon } from "lucide-react";

import { motionPublicUrl } from "@/lib/api";
import type { MotionFound } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { cn } from "@/components/ui";

/** The colour a card's icon tile takes, so each kind of card reads at a glance. */
export type Tone = "accent" | "ok" | "warn" | "mute";
export const TONE: Record<Tone, string> = {
  accent: "bg-accent/15 text-accent",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  mute: "bg-panel-hi text-mute",
};

/** A small rounded tile holding an icon, in a tone. */
export const IconTile = ({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) => (
  <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", TONE[tone])}>
    <Icon className="size-3.5" strokeWidth={2.25} />
  </span>
);

/** A titled card in the film studio, its kind shown by its icon tile. */
export function Card({ title, icon, tone = "mute", aside, className, children }: { title: string; icon?: LucideIcon; tone?: Tone; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn("rise rounded-2xl border border-line bg-panel p-5", className)}>
      <h2 className="mb-4 flex items-center justify-between gap-3 text-[14px] font-medium text-fg">
        <span className="flex items-center gap-2.5">
          {icon && <IconTile icon={icon} tone={tone} />}
          {title}
        </span>
        {aside}
      </h2>
      {children}
    </section>
  );
}

const MARK = /icon|logo/;

/** What the research found on the first link: the product's name, marks, colours, fonts and images. */
export function FoundCard({ projectId, found, className }: { projectId: string; found: MotionFound; className?: string }) {
  const mark = found.images.find((name) => MARK.test(name));
  const pictures = found.images.filter((name) => !MARK.test(name)).slice(0, 4);
  const host = (() => {
    try {
      return new URL(found.url).host.replace(/^www\./, "");
    } catch {
      return found.url;
    }
  })();
  return (
    <Card title="What we found" icon={Search} tone="mute" aside={<span className="truncate text-xs font-normal text-dim">{host}</span>} className={className}>
      <div className="flex items-start gap-3">
        {mark && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={motionPublicUrl(projectId, `context/${mark}`)} alt="" className="size-11 shrink-0 rounded-xl border border-line bg-panel-hi object-contain p-1.5" />
        )}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-fg">{found.siteName ?? found.title ?? host}</div>
          {found.description && <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-mute">{found.description}</p>}
        </div>
      </div>

      {found.colors.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Colours">
          {found.colors.slice(0, 6).map((color) => (
            <span key={color} className="flex items-center gap-1.5 rounded-full border border-line bg-panel-hi py-1 pl-1 pr-2.5 font-mono text-[11px] text-mute">
              <span className="size-4 rounded-full border border-white/10" style={{ background: color }} />
              {color}
            </span>
          ))}
        </div>
      )}

      {found.fonts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Fonts">
          {found.fonts.slice(0, 4).map((font) => (
            <span key={font} className="rounded-full bg-panel-hi px-2.5 py-1 text-[12px] text-mute">
              {font}
            </span>
          ))}
        </div>
      )}

      {pictures.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {pictures.map((name, i) => (
            <div key={name} style={{ animationDelay: `${i * 70}ms` }} className="rise aspect-video overflow-hidden rounded-lg border border-line bg-panel-hi">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={motionPublicUrl(projectId, `context/${name}`)} alt="" loading="lazy" className="size-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** **bold** and `code` inside a line of the plan. */
const inline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-medium text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className="rounded bg-panel-hi px-1 font-mono text-[12px]">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );

type Block = { kind: "heading" | "item" | "para"; text: string; n?: string };

/** PLAN.md as blocks: headings, list items (numbered or not, wrapped lines joined) and paragraphs. */
const blocksOf = (plan: string): Block[] => {
  const blocks: Block[] = [];
  for (const raw of plan.split("\n")) {
    const line = raw.trim();
    const last = blocks.at(-1);
    if (!line) {
      blocks.push({ kind: "para", text: "" });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(\d+[.)]|[-*])\s+(.*)$/.exec(line);
    if (heading) blocks.push({ kind: "heading", text: heading[1]! });
    else if (item) blocks.push({ kind: "item", text: item[2]!, n: /\d/.test(item[1]!) ? item[1]!.replace(/\D/g, "") : undefined });
    else if (last && last.text && last.kind !== "heading") last.text += ` ${line}`;
    else blocks.push({ kind: "para", text: line });
  }
  return blocks.filter((b) => b.text);
};

/** The film session's markdown (the plan) as readable text: headings, list items and paragraphs. */
function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[13px] leading-relaxed text-mute", className)}>
      {blocksOf(text).map((block, i) =>
        block.kind === "heading" ? (
          <h3 key={i} className="pt-1 text-[14px] font-medium text-fg first:pt-0">
            {inline(block.text)}
          </h3>
        ) : block.kind === "item" ? (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-panel-hi text-[11px] font-medium tabular-nums text-mute">{block.n ?? "•"}</span>
            <p className="min-w-0">{inline(block.text)}</p>
          </div>
        ) : (
          <p key={i}>{inline(block.text)}</p>
        )
      )}
    </div>
  );
}

/** The plan's story: the first sentence of its idea and its beats' titles, none of its production notes. */
const storyOfPlan = (plan: string): { idea: string; beats: Array<{ at?: number; text: string }> } => {
  const blocks = blocksOf(plan);
  const section = (name: RegExp): Block[] => {
    const start = blocks.findIndex((b) => b.kind === "heading" && name.test(b.text));
    if (start < 0) return [];
    const end = blocks.findIndex((b, i) => i > start && b.kind === "heading");
    return blocks.slice(start + 1, end < 0 ? undefined : end);
  };
  // "## Idea" and what follows it, or a paragraph that opens with "**Idea.**"
  const lead = /^\*\*idea[.:]?\*\*\s*/i;
  const idea = section(/idea/i).map((b) => b.text).join(" ") || (blocks.find((b) => b.kind === "para" && lead.test(b.text))?.text.replace(lead, "") ?? "");
  const beats = section(/beat/i)
    .filter((b) => b.kind === "item")
    // "**Hook, 0-4 s (line 1).** A flat…" or "Hook 0–3.5 s: a heavy…": the title alone
    .map((b) => ({ text: (/^\*\*(.+?)\*\*/.exec(b.text)?.[1] ?? b.text.split(/:\s| — | – /)[0]!).replace(/\(line \d+\)/i, "").replace(/[*`]/g, "").replace(/[\s.,:;]+$/, "").trim() }))
    .filter((b) => b.text);
  return { idea: (idea.replace(/[*`]/g, "").trim().split(/(?<=[.!?])\s+/)[0] ?? "").trim(), beats };
};

/**
 * The film's story as the user reads it, from its plan (PLAN.md): its idea,
 * then its beats. An admin can open the whole plan (the agent's production
 * notes).
 */
export function StoryboardCard({ plan, className }: { plan: string; className?: string }) {
  const admin = !!useMe()?.isAdmin;
  const [open, setOpen] = useState(false);
  const told: { idea: string; beats: Array<{ at?: number; text: string }> } = storyOfPlan(plan);
  if (!told.idea && !told.beats.length && !(admin && plan)) return null;
  return (
    <Card title="Storyboard" icon={Clapperboard} tone="accent" className={className}>
      {told.idea && <p className="text-[15px] leading-relaxed text-fg">{told.idea}</p>}
      {told.beats.length > 0 && (
        <ol className={cn("space-y-2.5", told.idea && "mt-4")}>
          {told.beats.map((beat, i) => (
            <li key={i} style={{ animationDelay: `${i * 70}ms` }} className="rise flex gap-3">
              <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-dim">{beat.at === undefined ? i + 1 : `${Math.round(beat.at)}s`}</span>
              <span className="text-[14px] leading-snug text-fg">{beat.text}</span>
            </li>
          ))}
        </ol>
      )}
      {admin && plan && (
        <>
          {open && <Prose text={plan} className="mt-4 border-t border-line pt-4" />}
          <button onClick={() => setOpen((o) => !o)} className="mt-3 cursor-pointer text-[13px] font-medium text-accent hover:text-accent-hi">
            {open ? "Hide the plan" : "Show the whole plan (admin)"}
          </button>
        </>
      )}
    </Card>
  );
}
