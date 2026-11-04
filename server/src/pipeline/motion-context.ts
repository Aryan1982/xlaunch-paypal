/**
 * Link research for a motion film, as the prompt-video studio does it: the
 * links in the request are fetched and their text, colours, fonts and images
 * written into the agent's workspace (context.md, public/context/).
 */
import fs from "node:fs";
import path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";

import type { MotionFound } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_MAX_CHARS = 7000;
const MAX_URLS = 4;
const MAX_IMAGES_PER_PAGE = 6;
const MAX_STYLESHEETS = 3;
const STYLESHEET_MAX_BYTES = 1024 * 1024;

const EXPLICIT_URL = /https?:\/\/[^\s<>"'`]+/gi;
// Bare domains such as "linear.app", "kapshot.cloud" or "www.stripe.com/pricing": any alphabetic
// ending (new endings appear all the time), except the file extensions a request mentions.
const BARE_DOMAIN =
  /(?<![@\w./-])(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.([a-z]{2,24})(?![\w-])(?:\/[^\s<>"'`]*)?/gi;
const FILE_EXTENSIONS: Record<string, true> = Object.fromEntries(
  "js mjs cjs ts tsx jsx json md mdx css scss html htm txt pdf png jpg jpeg gif svg webp avif ico mp4 mov webm mp3 wav csv xml yml yaml lock log py rb rs java kt swift zip gz env ini toml"
    .split(" ")
    .map((ext) => [ext, true]),
);

export function extractUrls(text: string): string[] {
  const found: string[] = [];
  const withoutExplicit = text.replace(EXPLICIT_URL, (match) => {
    found.push(match);
    return " ";
  });
  for (const [match, ending] of withoutExplicit.matchAll(BARE_DOMAIN)) {
    if (!FILE_EXTENSIONS[ending!.toLowerCase()]) found.push(`https://${match}`);
  }
  const cleaned = found.map((u) => u.replace(/[.,;:!?)\]}]+$/, ""));
  return [...new Set(cleaned)].filter((u) => URL.canParse(u)).slice(0, MAX_URLS);
}

async function fetchLimited(url: string, maxBytes: number) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "", finalUrl: res.url || url };
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** Downloads an image into `dir`; returns the file name, or null when it is not a usable image. */
async function downloadImage(url: string, dir: string, baseName: string): Promise<string | null> {
  try {
    const { buffer, contentType } = await fetchLimited(url, IMAGE_MAX_BYTES);
    const ext = EXTENSION_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()];
    if (!ext || buffer.byteLength < 200) return null;
    const name = `${baseName}.${ext}`;
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dir, name), buffer);
    return name;
  } catch {
    return null;
  }
}

function meta(doc: HTMLElement, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const el = doc.querySelector(`meta[property="${key}"]`) ?? doc.querySelector(`meta[name="${key}"]`);
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

/** The hex colours in the page and its stylesheets: the most used ones, and the accents (hues) among them. */
function colorSummary(text: string): { used: string[]; accents: string[] } {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let hex = match[0].toLowerCase();
    if (hex.length === 4) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const byUse = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const label = ([hex, n]: [string, number]) => `${hex} (${n}x)`;
  return { used: byUse.slice(0, 10).map(label), accents: byUse.filter(([hex]) => isAccent(hex)).slice(0, 6).map(label) };
}

/** A colour that reads as a hue (a brand accent), not a grey, near-black or near-white. */
function isAccent(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.4 && lightness >= 0.2 && lightness <= 0.85;
}

/** The page's own stylesheets (same site, a few): where most sites keep their colours. */
async function stylesheets(doc: HTMLElement, pageUrl: string): Promise<string> {
  const origin = new URL(pageUrl).origin;
  const hrefs = doc
    .querySelectorAll('link[rel~="stylesheet"]')
    .map((link) => link.getAttribute("href"))
    .filter((href): href is string => !!href && URL.canParse(href, pageUrl))
    .map((href) => new URL(href, pageUrl))
    .filter((url) => url.origin === origin)
    .slice(0, MAX_STYLESHEETS);
  const texts = await Promise.all(hrefs.map((url) => fetchLimited(url.href, STYLESHEET_MAX_BYTES).then((r) => r.buffer.toString("utf8"), () => "")));
  return texts.join("\n");
}

function fontFamilies(html: string): string[] {
  const families = new Map<string, number>();
  for (const match of html.matchAll(/font-family\s*:\s*([^;}"]+)/gi)) {
    const first = match[1].split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    if (!first || first.startsWith("var(") || /^(inherit|initial|sans-serif|serif|monospace)$/i.test(first)) continue;
    families.set(first, (families.get(first) ?? 0) + 1);
  }
  for (const match of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)) {
    const name = decodeURIComponent(match[1]).split(":")[0].replace(/\+/g, " ");
    families.set(name, (families.get(name) ?? 0) + 5);
  }
  return [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f]) => f);
}

function readableText(doc: HTMLElement): string {
  const body = doc.querySelector("main") ?? doc.querySelector("body") ?? doc;
  body.querySelectorAll("script,style,noscript,svg,iframe,form,template").forEach((el) => el.remove());
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const el of body.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,figcaption,button,a")) {
    const text = el.text.replace(/\s+/g, " ").trim();
    if (text.length < 3 || text.length > 400 || seen.has(text)) continue;
    seen.add(text);
    const tag = el.tagName.toLowerCase();
    lines.push(tag.startsWith("h") ? `${"#".repeat(Number(tag[1]) + 2)} ${text}` : `- ${text}`);
  }
  let out = "";
  for (const line of lines) {
    if (out.length + line.length > TEXT_MAX_CHARS) break;
    out += `${line}\n`;
  }
  return out;
}

function imageCandidates(doc: HTMLElement, base: string): { kind: string; url: string }[] {
  const abs = (u: string | undefined) => {
    if (!u || u.startsWith("data:")) return undefined;
    try {
      return new URL(u, base).toString();
    } catch {
      return undefined;
    }
  };
  const out: { kind: string; url: string }[] = [];
  const push = (kind: string, u: string | undefined) => {
    const url = abs(u);
    if (url && !out.some((c) => c.url === url)) out.push({ kind, url });
  };

  push("og-image", meta(doc, "og:image", "og:image:url", "twitter:image"));
  const icons = doc
    .querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]')
    .map((el) => ({ href: el.getAttribute("href"), size: Number(el.getAttribute("sizes")?.split("x")[0]) || 0 }))
    .sort((a, b) => b.size - a.size);
  push("icon", icons[0]?.href);
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? img.getAttribute("data-src");
    const hint = `${img.getAttribute("alt") ?? ""} ${img.getAttribute("class") ?? ""} ${src ?? ""}`.toLowerCase();
    if (hint.includes("logo")) push("logo", src);
  }
  for (const img of doc.querySelectorAll("img")) {
    const width = Number(img.getAttribute("width"));
    if (!width || width >= 600) push("image", img.getAttribute("src") ?? img.getAttribute("data-src"));
  }
  return out.slice(0, MAX_IMAGES_PER_PAGE);
}

/** What one fetched page says about the product. */
export type PageFacts = MotionFound;

export interface ContextResult {
  markdown: string;
  images: string[];
  notes: string[];
  pages: PageFacts[];
}

/**
 * Fetches each URL, writes the useful parts as markdown and downloads its images into
 * `assetsDir` (files named `<page index>-<kind>-<n>.<ext>`).
 */
export async function gatherContext(urls: string[], assetsDir: string, prefix: string): Promise<ContextResult> {
  fs.mkdirSync(assetsDir, { recursive: true });
  const sections: string[] = [];
  const images: string[] = [];
  const notes: string[] = [];
  const pages: PageFacts[] = [];

  for (const [index, url] of urls.entries()) {
    const tag = `${prefix}${index + 1}`;
    try {
      const page = await fetchLimited(url, PAGE_MAX_BYTES);
      const type = page.contentType.toLowerCase();

      if (type.startsWith("image/")) {
        const name = await downloadImage(url, assetsDir, `${tag}-image`);
        if (name) images.push(name);
        sections.push(`## ${url}\n\nDirect image link, saved as \`public/context/${name}\`.`);
        notes.push(`${url}: image`);
        continue;
      }
      if (!type.includes("html")) {
        const text = page.buffer.toString("utf8").slice(0, TEXT_MAX_CHARS);
        sections.push(`## ${url}\n\nContent-Type: ${type}\n\n\`\`\`\n${text}\n\`\`\``);
        notes.push(`${url}: ${type}`);
        continue;
      }

      const html = page.buffer.toString("utf8");
      const doc = parse(html);
      const title = meta(doc, "og:title", "twitter:title") ?? doc.querySelector("title")?.text.trim();
      const description = meta(doc, "og:description", "description", "twitter:description");
      const siteName = meta(doc, "og:site_name", "application-name");
      const themeColor = meta(doc, "theme-color");
      const styled = `${html}\n${await stylesheets(doc, page.finalUrl)}`;
      const { used: colors, accents } = colorSummary(styled);
      const fonts = fontFamilies(styled);

      const saved: string[] = [];
      const savedNames: string[] = [];
      const counts = new Map<string, number>();
      for (const candidate of imageCandidates(doc, page.finalUrl)) {
        const n = (counts.get(candidate.kind) ?? 0) + 1;
        counts.set(candidate.kind, n);
        const name = await downloadImage(candidate.url, assetsDir, `${tag}-${candidate.kind}-${n}`);
        if (name) saved.push(`- \`public/context/${name}\` (${candidate.kind}, from ${candidate.url})`);
        if (name) images.push(name);
        if (name) savedNames.push(name);
      }
      // the colours without their counts ("#e2e4e7 (429x)" → "#e2e4e7"): the theme colour, then the accents, then the rest
      const hexes = [...new Set([themeColor, ...accents, ...colors].filter((c): c is string => !!c).map((c) => c.split(" ")[0]!))];
      pages.push({ url: page.finalUrl, siteName, title, description, colors: hexes, fonts, images: savedNames });

      sections.push(
        [
          `## ${page.finalUrl}`,
          "",
          siteName && `- Site name: ${siteName}`,
          title && `- Title: ${title}`,
          description && `- Description: ${description}`,
          themeColor && `- Theme colour: ${themeColor}`,
          accents.length > 0 && `- Accent (brand) colours, from the page and its stylesheets: ${accents.join(", ")}`,
          colors.length > 0 && `- Most used hex colours in the HTML/CSS: ${colors.join(", ")}`,
          fonts.length > 0 && `- Fonts referenced: ${fonts.join(", ")}`,
          "",
          "### Images",
          saved.length > 0 ? saved.join("\n") : "- none downloaded",
          "",
          "### Page text",
          readableText(doc) || "(no readable text; the page is probably rendered client-side)",
        ]
          .filter((line) => line !== undefined && line !== false)
          .join("\n"),
      );
      notes.push(`${page.finalUrl}: “${title ?? "untitled"}”, ${saved.length} image(s)`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      sections.push(`## ${url}\n\nCould not fetch: ${reason}. Use WebFetch if you need it.`);
      notes.push(`${url}: failed (${reason})`);
    }
  }

  return { markdown: sections.join("\n\n"), images, notes, pages };
}
