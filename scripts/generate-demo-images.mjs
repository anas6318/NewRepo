/**
 * Generates ORIGINAL, neutral demo imagery (products, categories, hero,
 * editorial, review photos) as webp via sharp. No club badges, sponsor
 * marks, player likenesses or protected designs — plain geometric jersey
 * artwork on dark editorial backgrounds (spec §30/§36).
 *
 * Keep the slug list in sync with src/services/demo/seed-data.ts.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let sharp;
for (const c of ["sharp", "/home/claude/.npm-global/lib/node_modules/sharp"]) {
  try {
    sharp = require(c);
    break;
  } catch {
    /* next */
  }
}
if (!sharp) {
  console.error("sharp not available — run npm install");
  process.exit(1);
}

const OUT = join(process.cwd(), "public", "demo");
mkdirSync(OUT, { recursive: true });

/** slug → [primary, secondary, accent, style] */
const PRODUCTS = {
  "crimson-2005": ["#7a1f24", "#5a1418", "#e8d9a0", "hoops"],
  "royal-1998": ["#1f3d7a", "#152a56", "#e8e4d8", "plain"],
  "emerald-2007": ["#1d5c3f", "#123f2a", "#d9c want", "plain"],
  "amber-2001": ["#b35c1e", "#8a4414", "#f2e6cf", "stripes"],
  "onyx-home": ["#17171c", "#0d0d10", "#c6a355", "pinstripes"],
  "ivory-away": ["#e9e5da", "#d8d2c2", "#4a4a52", "plain"],
  "azure-national": ["#2b6ea6", "#1d4f7a", "#f0ead6", "plain"],
  "scarlet-national": ["#a62b33", "#7a1d24", "#f0ead6", "stripes"],
  "graphite-player": ["#3a3a42", "#26262c", "#c6a355", "pinstripes"],
  "classic-white-fan": ["#eeeae0", "#dcd6c6", "#2b2b33", "plain"],
  "midnight-longsleeve": ["#1b2440", "#111830", "#d4b878", "plain", true],
  "stealth-hoodie": ["#141417", "#0c0c0f", "#c6a355", "hoodie"],
  "cream-hoodie": ["#e7dfc9", "#d6ccb0", "#8a6a2b", "hoodie"],
  "sunrise-kids": ["#d98a2b", "#b06a1a", "#f4ecd8", "kids"],
  "cobalt-kids": ["#2b4fd9", "#1d38a6", "#f4ecd8", "kids"],
  "obsidian-2004": ["#121215", "#0a0a0c", "#9aa0ad", "plain"],
};

// fix accidental typo-proof: replace invalid color
PRODUCTS["emerald-2007"][2] = "#d9cfa8";

function jerseySvg([c1, c2, accent, style, long = false], w = 900, h = 1125) {
  const sleeveLen = long || style === "hoodie" ? 300 : 130;
  const pattern =
    style === "hoops"
      ? `<g clip-path="url(#body)">${[0, 1, 2, 3, 4].map((i) => `<rect x="150" y="${330 + i * 120}" width="600" height="52" fill="${c2}"/>`).join("")}</g>`
      : style === "stripes" || style === "pinstripes"
        ? `<g clip-path="url(#body)">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${205 + i * 82}" y="220" width="${style === "pinstripes" ? 6 : 40}" height="720" fill="${style === "pinstripes" ? accent : c2}" opacity="${style === "pinstripes" ? 0.8 : 1}"/>`).join("")}</g>`
        : "";
  const hood = style === "hoodie" ? `<path d="M330 240 Q450 130 570 240 Q560 300 450 320 Q340 300 330 240 Z" fill="${c2}"/>` : "";
  const kidsScale = style === "kids" ? 0.82 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 900 1125">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="#1d1d24"/>
      <stop offset="55%" stop-color="#121216"/>
      <stop offset="100%" stop-color="#0b0b0d"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#c6a355" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#c6a355" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="body"><path d="M300 250 L360 210 Q450 260 540 210 L600 250 L600 940 Q450 985 300 940 Z"/></clipPath>
  </defs>
  <rect width="900" height="1125" fill="url(#bg)"/>
  <rect width="900" height="1125" fill="url(#glow)"/>
  <g transform="translate(450 575) scale(${kidsScale}) translate(-450 -575)">
    <g>
      <path d="M300 250 L360 210 Q450 260 540 210 L600 250 L600 940 Q450 985 300 940 Z" fill="${c1}"/>
      <path d="M300 250 L${180 - sleeveLen * 0.1} ${320 + sleeveLen * 0.35} L${225 - sleeveLen * 0.05} ${430 + sleeveLen} L300 ${380 + sleeveLen * 0.6} Z" fill="${c1}"/>
      <path d="M600 250 L${720 + sleeveLen * 0.1} ${320 + sleeveLen * 0.35} L${675 + sleeveLen * 0.05} ${430 + sleeveLen} L600 ${380 + sleeveLen * 0.6} Z" fill="${c1}"/>
      ${pattern}
      ${hood}
      <path d="M360 210 Q450 260 540 210 Q525 245 450 252 Q375 245 360 210 Z" fill="${c2}"/>
      <circle cx="380" cy="330" r="26" fill="none" stroke="${accent}" stroke-width="5"/>
      <path d="M368 330 l8 8 l16 -18" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>
      <path d="M300 250 L360 210 Q450 260 540 210 L600 250 L600 940 Q450 985 300 940 Z" fill="url(#sheen)"/>
    </g>
  </g>
  <rect x="0" y="1010" width="900" height="115" fill="#0b0b0d" opacity="0.55"/>
  <text x="450" y="1076" font-family="DejaVu Sans, sans-serif" font-size="30" letter-spacing="14" text-anchor="middle" fill="#c6a355">CROWNED</text>
</svg>`;
}

function detailSvg([c1, c2, accent], w = 900, h = 1125) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 900 1125">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1125" fill="url(#bg2)"/>
  <g opacity="0.92">
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<path d="M-80 ${90 + i * 130} q225 ${i % 2 ? 44 : -44} 530 0 t 530 0" fill="none" stroke="#0b0b0d" stroke-opacity="0.16" stroke-width="42"/>`).join("")}
  </g>
  <circle cx="450" cy="500" r="120" fill="none" stroke="${accent}" stroke-width="10"/>
  <path d="M395 505 l38 38 l78 -88" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>
  <text x="450" y="700" font-family="DejaVu Sans, sans-serif" font-size="26" letter-spacing="10" text-anchor="middle" fill="#0b0b0d" opacity="0.65">STITCH DETAIL</text>
  <text x="450" y="1064" font-family="DejaVu Sans, sans-serif" font-size="28" letter-spacing="13" text-anchor="middle" fill="${accent}">CROWNED</text>
</svg>`;
}

function sceneSvg(title, w, h, dark = true) {
  const bg = dark
    ? `<radialGradient id="s" cx="50%" cy="20%" r="95%"><stop offset="0%" stop-color="#23232b"/><stop offset="60%" stop-color="#121216"/><stop offset="100%" stop-color="#0b0b0d"/></radialGradient>`
    : `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f6f4ef"/><stop offset="100%" stop-color="#e6e2d6"/></linearGradient>`;
  const fg = dark ? "#c6a355" : "#8a6a2b";
  const lines = Array.from({ length: 12 }, (_, i) => `<line x1="${(w / 12) * i}" y1="0" x2="${(w / 12) * i - 160}" y2="${h}" stroke="${dark ? "#ffffff" : "#0b0b0d"}" stroke-opacity="0.05" stroke-width="2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${bg}</defs>
  <rect width="${w}" height="${h}" fill="url(#s)"/>
  ${lines}
  <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.42}" fill="${fg}" opacity="0.10"/>
  <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.28}" fill="none" stroke="${fg}" stroke-opacity="0.35" stroke-width="2"/>
  <path d="M${w * 0.72} ${h * 0.34} l${h * 0.05} ${h * 0.05} l${h * 0.1} -${h * 0.12}" fill="none" stroke="${fg}" stroke-opacity="0.5" stroke-width="6" stroke-linecap="round"/>
  <text x="${w / 2}" y="${h - 34}" font-family="DejaVu Sans, sans-serif" font-size="22" letter-spacing="11" text-anchor="middle" fill="${fg}" opacity="0.8">${title}</text>
</svg>`;
}

async function webp(svg, file, quality = 82) {
  await sharp(Buffer.from(svg)).webp({ quality }).toFile(join(OUT, file));
}

const jobs = [];
for (const [slug, spec] of Object.entries(PRODUCTS)) {
  jobs.push(webp(jerseySvg(spec), `p-${slug}.webp`));
  jobs.push(webp(detailSvg(spec), `p-${slug}-b.webp`));
}

const CATS = {
  "cat-retro": "#7a1f24",
  "cat-current": "#17171c",
  "cat-national": "#2b6ea6",
  "cat-player": "#3a3a42",
  "cat-fan": "#e9e5da",
  "cat-longsleeve": "#1b2440",
  "cat-hoodie": "#141417",
  "cat-kids": "#d98a2b",
};
for (const [name, color] of Object.entries(CATS)) {
  jobs.push(webp(jerseySvg([color, "#0d0d10", "#c6a355", name === "cat-hoodie" ? "hoodie" : name === "cat-kids" ? "kids" : "plain", name === "cat-longsleeve"], 800, 1000), `${name}.webp`));
}

jobs.push(webp(sceneSvg("FOOTBALL HISTORY, WORN AGAIN", 1920, 1080, true), "hero.webp", 80));
jobs.push(webp(sceneSvg("THE ARCHIVE", 1600, 900, true), "editorial.webp", 80));
jobs.push(webp(sceneSvg("CROWNED", 1200, 630, true), "og.webp", 80));
jobs.push(webp(sceneSvg("DEMO REVIEW PHOTO", 800, 800, false), "rev-1.webp"));
jobs.push(webp(sceneSvg("DEMO REVIEW PHOTO", 800, 800, true), "rev-2.webp"));

await Promise.all(jobs);
console.log(`generated ${jobs.length} images → public/demo/`);
