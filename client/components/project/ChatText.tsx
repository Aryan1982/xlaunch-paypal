import { Fragment, type ReactNode } from "react";

/**
 * An assistant reply as the agent writes it: plain paragraphs, "- " or "1. "
 * lists, **bold** and `code`. Built from React elements (never HTML), so
 * nothing in the text can inject markup.
 */
export function ChatText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullets || numbered) {
          const items = lines.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
          const List = numbered ? "ol" : "ul";
          return (
            <List key={i} className={numbered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5 marker:text-dim"}>
              {items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** `code` and **bold** inside one line. */
function inline(line: string): ReactNode[] {
  return line.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-panel-hi px-1 py-px font-mono text-[12.5px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
