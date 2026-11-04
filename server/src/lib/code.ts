/**
 * Pulling JSON out of a model reply. Pure, so it is trivially unit-testable.
 */

/**
 * The first balanced JSON value starting at `from` (an object or array),
 * scanned with string and escape awareness, so trailing prose or a second
 * block after it doesn't matter. Null when it never closes.
 */
const balancedAt = (text: string, from: number): string | null => {
  const open = text[from];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return ch === close ? text.slice(from, i + 1) : null;
    }
  }
  return null;
};

/** Trivial, safe repairs: smart quotes around keys/strings and trailing commas. */
const repairJson = (text: string): string =>
  text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,(\s*[}\]])/g, "$1");

/**
 * Pull a JSON value out of a model reply: a fenced block if there is one,
 * else the first balanced object (or array) in the text. Leading prose,
 * trailing commentary and a second JSON block after it are ignored, so a
 * correct answer with chatter around it is never sent back for a retry.
 */
export const extractJson = (raw: string): unknown => {
  const fences = Array.from(raw.matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g)).map((m) => m[1]);
  const sources = [...fences, raw];
  let lastError: unknown = null;
  // objects first (every reply schema is an object), then a bare array
  for (const opener of ["{", "["]) {
    for (const source of sources) {
      for (let i = source.indexOf(opener); i !== -1; i = source.indexOf(opener, i + 1)) {
        const block = balancedAt(source, i);
        if (!block) continue;
        for (const candidate of [block, repairJson(block)]) {
          try {
            return JSON.parse(candidate);
          } catch (error) {
            lastError = error;
          }
        }
        // a balanced but broken block: look after it
        i += block.length - 1;
      }
    }
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  throw new Error("The model reply contained no JSON object.");
};
