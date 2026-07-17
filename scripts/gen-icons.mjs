// Generate neutral, white-label PWA icons for Mate.
//
// NO Auto Mate branding, NO client branding — per-client theming is applied at
// runtime, so the install icon is deliberately generic: a dark rounded square
// (#141414) with a light off-white (#ede6e6) lowercase "m".
//
// Outputs (in ../public/icons/):
//   icon-192.png            192x192  standard
//   icon-512.png            512x512  standard
//   icon-maskable-512.png   512x512  maskable (glyph inside ~80% safe zone)
//
// Run from the app root:  node scripts/gen-icons.mjs
// Requires: sharp (already a transitive dep in node_modules).

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "icons");

const DARK = "#141414";
const LIGHT = "#ede6e6";

// A symmetric lowercase "m": a left vertical stem plus two identical arches.
// `scale` shrinks the glyph toward the center (used for the maskable safe zone).
// Canvas is 512x512; the glyph is centered on it.
function glyphPaths(scale) {
  const cx = 256;
  const cy = 256;

  // Base glyph geometry at scale 1.0 (relative to centre).
  const halfW = 108; // glyph spans ~216px wide before scaling
  const top = -76; // arch top
  const bottom = 96; // baseline
  const stemLeft = -halfW;
  const midX = 0;
  const stemRight = halfW;
  const archRise = 60; // how far below the top the arch shoulder begins

  const sx = (v) => cx + v * scale;
  const sy = (v) => cy + v * scale;

  // Three verticals (left stem, middle, right) with two connecting arches.
  const stem = `M ${sx(stemLeft)} ${sy(top + archRise)} L ${sx(stemLeft)} ${sy(bottom)}`;
  const arch1 =
    `M ${sx(stemLeft)} ${sy(top + archRise)} ` +
    `C ${sx(stemLeft)} ${sy(top)} ${sx(midX)} ${sy(top)} ${sx(midX)} ${sy(top + archRise)} ` +
    `L ${sx(midX)} ${sy(bottom)}`;
  const arch2 =
    `M ${sx(midX)} ${sy(top + archRise)} ` +
    `C ${sx(midX)} ${sy(top)} ${sx(stemRight)} ${sy(top)} ${sx(stemRight)} ${sy(top + archRise)} ` +
    `L ${sx(stemRight)} ${sy(bottom)}`;

  return [stem, arch1, arch2];
}

function iconSvg({ maskable }) {
  // Standard icons fill the whole canvas with the rounded square.
  // Maskable icons: the OS applies its own mask, so the background must fill the
  // full square (no rounded corners of our own) and the glyph must sit inside
  // the ~80% safe zone. We scale the glyph to ~0.62 to stay well clear.
  const glyphScale = maskable ? 0.62 : 1;
  const strokeW = maskable ? 34 * 0.62 : 34;
  const bg = maskable
    ? `<rect width="512" height="512" fill="${DARK}"/>`
    : `<rect width="512" height="512" rx="112" fill="${DARK}"/>`;

  const paths = glyphPaths(glyphScale)
    .map((d) => `<path d="${d}"/>`)
    .join("\n    ");

  return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mate">
  ${bg}
  <g fill="none" stroke="${LIGHT}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">
    ${paths}
  </g>
</svg>`;
}

async function render(svg, size, outfile) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(OUT_DIR, outfile));
  console.log(`  wrote ${outfile} (${size}x${size})`);
}

const standard = iconSvg({ maskable: false });
const maskable = iconSvg({ maskable: true });

console.log("Generating neutral Mate PWA icons ->", OUT_DIR);
await render(standard, 192, "icon-192.png");
await render(standard, 512, "icon-512.png");
await render(maskable, 512, "icon-maskable-512.png");
console.log("Done.");
