// Generates the share cards (Open Graph and Twitter, 1200x630) as static PNGs
// in app/, where Next picks them up by file name. Run again after changing the
// copy or the frames:
//
//   node scripts/og/make-cards.mjs
//
// Background: the 3D home backdrop (public/hero-3d.svg). The home card shows a
// real 2D and 3D frame (frame-2d.png, frame-3d.png: stills of the demo videos).
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const W = 1200;
const H = 630;
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const backdrop = async () =>
  sharp(join(ROOT, "public/hero-3d.svg"))
    .resize(W, H, { fit: "cover" })
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#0b0c14" opacity="0.62"/><rect width="60%" height="100%" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#0b0c14" stop-opacity=".75"/><stop offset="1" stop-color="#0b0c14" stop-opacity="0"/></linearGradient></defs></svg>`) }])
    .png()
    .toBuffer();

const logo = (size) => sharp(join(ROOT, "public/logo/icon.png")).resize(size, size).png().toBuffer();

/** A rounded, shadowed frame with a small label. */
const frame = async (file, w, label) => {
  const h = Math.round((w * 9) / 16);
  const r = 18;
  const img = await sharp(join(ROOT, "scripts/og", file))
    .resize(w, h, { fit: "cover" })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`), blend: "dest-in" }])
    .png()
    .toBuffer();
  const pad = 30;
  const tag = `<svg width="${w + pad * 2}" height="${h + pad * 2}">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity=".55"/></filter></defs>
    <rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${r}" fill="#000" filter="url(#s)"/>
  </svg>`;
  const badge = `<svg width="${w + pad * 2}" height="${h + pad * 2}">
    <rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="2"/>
    <rect x="${pad + 14}" y="${pad + h - 48}" width="${label.length * 13 + 26}" height="34" rx="17" fill="#0b0c14" fill-opacity=".78"/>
    <text x="${pad + 27}" y="${pad + h - 25}" font-family="${FONT}" font-size="19" font-weight="700" fill="#fff">${esc(label)}</text>
  </svg>`;
  return sharp(Buffer.from(tag))
    .composite([{ input: img, left: pad, top: pad }, { input: Buffer.from(badge) }])
    .png()
    .toBuffer();
};

const text = (lines) =>
  Buffer.from(`<svg width="${W}" height="${H}">${lines
    .map((l) => `<text x="${l.x ?? 72}" y="${l.y}" font-family="${FONT}" font-size="${l.size}" font-weight="${l.weight ?? 400}" letter-spacing="${l.spacing ?? 0}" fill="${l.color ?? "#fff"}" ${l.opacity ? `fill-opacity="${l.opacity}"` : ""}>${esc(l.text)}</text>`)
    .join("")}</svg>`);

const brand = async () => [
  { input: await logo(56), left: 72, top: 64 },
  { input: text([{ text: "XLaunch", x: 142, y: 104, size: 34, weight: 700, spacing: -0.5 }]) },
];

const card = async (out, layers) => {
  const png = await sharp(await backdrop()).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  for (const f of out) writeFileSync(join(ROOT, f), png);
  console.log("wrote", out.join(", "));
};

/** Home: the pitch on the left, a real 2D and 3D frame on the right. */
await card(["app/opengraph-image.png", "app/twitter-image.png"], [
  ...(await brand()),
  { input: await frame("frame-2d.png", 400, "2D"), left: 770, top: 46 },
  { input: await frame("frame-3d.png", 400, "3D"), left: 720, top: 296 },
  {
    input: text([
      { text: "Launch videos", y: 262, size: 62, weight: 700, spacing: -1.5 },
      { text: "from your website.", y: 334, size: 62, weight: 700, spacing: -1.5, color: "#f2b37e" },
      { text: "Paste a URL. Get a custom 2D or 3D", y: 420, size: 28, opacity: 0.82 },
      { text: "video, editable by chat.", y: 458, size: 28, opacity: 0.82 },
      { text: "xlaunch.pro", y: 560, size: 26, weight: 700, opacity: 0.9 },
    ]),
  },
]);

/** A simple titled card for the other public pages. */
const simple = async (out, title, sub) =>
  card(out, [
    ...(await brand()),
    {
      input: text([
        { text: title, y: 330, size: 76, weight: 700, spacing: -2 },
        { text: sub, y: 400, size: 30, opacity: 0.82 },
        { text: "xlaunch.pro", y: 560, size: 26, weight: 700, opacity: 0.9 },
      ]),
    },
  ]);

await simple(["app/terms/opengraph-image.png", "app/terms/twitter-image.png"], "Terms of Service", "The terms for making launch videos with XLaunch.");
await simple(["app/privacy/opengraph-image.png", "app/privacy/twitter-image.png"], "Privacy Policy", "How XLaunch handles your data.");
await simple(["app/login/opengraph-image.png", "app/login/twitter-image.png"], "Sign in to XLaunch", "Turn your website into a launch video.");

const alts = {
  "app/opengraph-image.alt.txt": "XLaunch: launch videos from your website, shown with a 2D and a 3D example frame",
  "app/twitter-image.alt.txt": "XLaunch: launch videos from your website, shown with a 2D and a 3D example frame",
  "app/terms/opengraph-image.alt.txt": "XLaunch Terms of Service",
  "app/terms/twitter-image.alt.txt": "XLaunch Terms of Service",
  "app/privacy/opengraph-image.alt.txt": "XLaunch Privacy Policy",
  "app/privacy/twitter-image.alt.txt": "XLaunch Privacy Policy",
  "app/login/opengraph-image.alt.txt": "Sign in to XLaunch",
  "app/login/twitter-image.alt.txt": "Sign in to XLaunch",
};
for (const [f, t] of Object.entries(alts)) writeFileSync(join(ROOT, f), t);
