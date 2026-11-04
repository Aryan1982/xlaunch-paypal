"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** One line of code with a copy button. The line never wraps; it scrolls sideways when narrow, with the button kept in reach beside it. */
export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-bg py-1.5 pl-4 pr-1.5">
      <code className="scroll-thin min-w-0 flex-1 overflow-x-auto whitespace-pre py-1.5 font-mono text-[13px] leading-relaxed text-fg">{text}</code>
      <button
        type="button"
        aria-label="Copy"
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md text-mute hover:bg-panel-hi hover:text-fg sm:size-8"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
