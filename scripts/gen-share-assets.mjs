// Generates the OG share image and the dedicated maskable icon from SVG via
// sharp. Run: node scripts/gen-share-assets.mjs
// Outputs:
//   public/og.png                  1200x630  brand share card
//   public/icon-maskable-512.png   512x512   tile motif in ~80% safe zone
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

const RAMP = ["#5E9459", "#4F8A8B", "#3E6660", "#6FA39A", "#C9A875", "#E7D9C4"];

// ── OG image: 1200x630, brand bg gradient #F4F5F2 → #ECF0EB ──────────────────
function ogSvg() {
  const tileW = 84;
  const tileH = 120;
  const gap = 18;
  const totalW = RAMP.length * tileW + (RAMP.length - 1) * gap;
  const startX = (1200 - totalW) / 2;
  const tilesY = 150;
  const tiles = RAMP.map(
    (c, i) =>
      `<rect x="${startX + i * (tileW + gap)}" y="${tilesY}" width="${tileW}" height="${tileH}" rx="20" fill="${c}"/>`
  ).join("\n    ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F4F5F2"/>
      <stop offset="100%" stop-color="#ECF0EB"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
    ${tiles}
  <text x="600" y="400" text-anchor="middle" font-family="Newsreader, Georgia, 'Times New Roman', serif" font-size="92" font-weight="700" fill="#24332D">Spectrum</text>
  <text x="600" y="470" text-anchor="middle" font-family="'Atkinson Hyperlegible', -apple-system, Segoe UI, Roboto, sans-serif" font-size="34" fill="#4E5F58">Dating at your own pace.</text>
</svg>`;
}

// ── Maskable icon: 512x512, motif centred in ~80% safe zone on #3E6660 ───────
function maskableSvg() {
  // Safe zone ~80% → content within central 410px. Tile row scaled to fit.
  const tileW = 44;
  const tileH = 64;
  const gap = 12;
  const totalW = RAMP.length * tileW + (RAMP.length - 1) * gap;
  const startX = (512 - totalW) / 2;
  const tilesY = (512 - tileH) / 2;
  const tiles = RAMP.map(
    (c, i) =>
      `<rect x="${startX + i * (tileW + gap)}" y="${tilesY}" width="${tileW}" height="${tileH}" rx="12" fill="${c}"/>`
  ).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3E6660"/>
  ${tiles}
</svg>`;
}

async function main() {
  await sharp(Buffer.from(ogSvg()))
    .png()
    .toFile(path.join(PUBLIC, "og.png"));
  console.log("wrote public\\og.png");

  await sharp(Buffer.from(maskableSvg()))
    .png()
    .toFile(path.join(PUBLIC, "icon-maskable-512.png"));
  console.log("wrote public\\icon-maskable-512.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
