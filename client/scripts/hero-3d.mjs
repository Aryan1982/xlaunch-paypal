// Generates public/hero-3d.svg: the home page's backdrop in 3D mode, a
// low-poly dusk landscape (faceted sky, sun, three lit mountain ridges).
// Deterministic: the same seed draws the same picture.
//
//   node scripts/hero-3d.mjs
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const W = 2000;
const H = 1100;
const SUN = { x: 1390, y: 500, r: 118 };

let seed = 7;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const jitter = (n) => (rand() - 0.5) * 2 * n;

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const ramp = (stops, t) => {
  const s = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (s <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mix(hex(c0), hex(c1), (s - t0) / (t1 - t0));
    }
  }
  return hex(stops[stops.length - 1][1]);
};

const polys = [];
const tri = (a, b, c, fill) => polys.push(`<path d="M${a[0].toFixed(0)} ${a[1].toFixed(0)}L${b[0].toFixed(0)} ${b[1].toFixed(0)}L${c[0].toFixed(0)} ${c[1].toFixed(0)}Z" fill="${fill}"/>`);

// --- sky: a jittered grid split into triangles, coloured by height ---------
const SKY = [
  [0, "#141a3c"],
  [0.35, "#2e2f66"],
  [0.62, "#7a4f7e"],
  [0.82, "#d77a72"],
  [1, "#f6b072"],
];
const skyBottom = 900;
const cols = 16;
const rows = 8;
const grid = [];
for (let r = 0; r <= rows; r++) {
  const row = [];
  for (let c = 0; c <= cols; c++) {
    const x = (c / cols) * W + (c > 0 && c < cols ? jitter(42) : 0);
    const y = (r / rows) * skyBottom + (r > 0 && r < rows ? jitter(30) : 0);
    row.push([x, y]);
  }
  grid.push(row);
}
const skyFill = (pts) => {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
  let rgb = ramp(SKY, cy / skyBottom);
  const glow = Math.max(0, 1 - Math.hypot(cx - SUN.x, cy - SUN.y) / 620);
  rgb = mix(rgb, hex("#ffc88a"), glow * glow * 0.55);
  return toHex(rgb.map((v) => v * (1 + jitter(0.045))));
};
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const a = grid[r][c];
    const b = grid[r][c + 1];
    const d = grid[r + 1][c];
    const e = grid[r + 1][c + 1];
    const flip = (r + c) % 2 === 0;
    const t1 = flip ? [a, b, e] : [a, b, d];
    const t2 = flip ? [a, e, d] : [b, e, d];
    tri(...t1, skyFill(t1));
    tri(...t2, skyFill(t2));
  }
}

// --- sun: a faceted disc ---------------------------------------------------
const sunSides = 11;
const sunPts = Array.from({ length: sunSides }, (_, i) => {
  const a = (i / sunSides) * Math.PI * 2 - Math.PI / 2;
  const r = SUN.r * (1 + jitter(0.04));
  return [SUN.x + Math.cos(a) * r, SUN.y + Math.sin(a) * r];
});
const sunCore = [SUN.x - 18, SUN.y - 22];
for (let i = 0; i < sunSides; i++) {
  const a = sunPts[i];
  const b = sunPts[(i + 1) % sunSides];
  const lit = 0.5 + 0.5 * Math.cos(((i + 0.5) / sunSides) * Math.PI * 2 + 2.2);
  tri(sunCore, a, b, toHex(mix(hex("#ffb877"), hex("#fff0c9"), lit)));
}

// --- mountains: rows of points from the ridge down, lit from the sun ---------
const LIGHT = (() => {
  const v = [0.62, 0.38, 0.69];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

const ridge = (x, base, amp, f, p) =>
  base - amp * (0.55 * Math.sin(x * f + p) + 0.3 * Math.sin(x * f * 2.3 + p * 1.7) + 0.15 * Math.sin(x * f * 5.1 + p * 0.4));

const range = ({ base, amp, f, p, step, depthRows, shadow, lit, bottom }) => {
  const xs = [];
  for (let x = -step; x <= W + step; x += step) xs.push(x);
  const rowsPts = [];
  for (let r = 0; r <= depthRows; r++) {
    const t = r / depthRows;
    rowsPts.push(
      xs.map((x0, i) => {
        const x = x0 + (i % 2 ? step / 2 : 0) * (r % 2) + jitter(step * 0.22);
        const top = ridge(x, base, amp, f, p) + jitter(18);
        const y = top + (bottom - top) * t + (r > 0 && r < depthRows ? jitter(26) : 0);
        // height above the valley floor, falling off toward the viewer
        const z = (bottom - top) * (1 - t) * 0.9;
        return [x, r === depthRows ? bottom + 40 : y, z, r * 140];
      })
    );
  }
  const shade = (a, b, c) => {
    const u = [b[0] - a[0], b[3] - a[3], b[2] - a[2]];
    const v = [c[0] - a[0], c[3] - a[3], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    if (n[2] < 0) n = n.map((x) => -x);
    const k = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    return toHex(mix(hex(shadow), hex(lit), Math.pow(k, 1.6)).map((x) => x * (1 + jitter(0.03))));
  };
  for (let r = 0; r < depthRows; r++) {
    const up = rowsPts[r];
    const down = rowsPts[r + 1];
    for (let i = 0; i < xs.length - 1; i++) {
      const a = up[i];
      const b = up[i + 1];
      const d = down[i];
      const e = down[i + 1];
      tri(a, b, e, shade(a, b, e));
      tri(a, e, d, shade(a, e, d));
    }
  }
};

range({ base: 640, amp: 150, f: 0.0031, p: 1.3, step: 120, depthRows: 3, shadow: "#3b3466", lit: "#c98a8c", bottom: 900 });
range({ base: 780, amp: 120, f: 0.0042, p: 4.1, step: 100, depthRows: 3, shadow: "#24224a", lit: "#91607a", bottom: 1020 });
range({ base: 920, amp: 90, f: 0.0055, p: 2.4, step: 90, depthRows: 2, shadow: "#121530", lit: "#4f3a5c", bottom: H });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">
<defs><radialGradient id="glow"><stop offset="0" stop-color="#ffd59a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient></defs>
${polys.slice(0, cols * rows * 2).join("")}
<circle cx="${SUN.x}" cy="${SUN.y}" r="${SUN.r * 3.2}" fill="url(#glow)"/>
${polys.slice(cols * rows * 2).join("")}
</svg>
`;

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "hero-3d.svg");
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(0)} KB, ${polys.length} facets)`);
