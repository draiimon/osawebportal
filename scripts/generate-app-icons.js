"use strict";

// Generates two app icons (student + admin) by compositing the EAC emblem
// over distinct branded backgrounds. The emblem itself is never modified.
// Output: 512x512 PNG (PWA / APK), 192x192 PNG (manifest minimum).

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const EMBLEM_SRC = path.join(ROOT, "public", "assets", "images", "eac-emblem-large.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "images");

const SIZE = 512;
const EMBLEM_SIZE = 340; // emblem inset inside the 512 canvas

const STUDENT_BG_SVG = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="60%" stop-color="#fbecd0"/>
      <stop offset="100%" stop-color="#e8c882"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="96" ry="96" fill="url(#bg)"/>
  <rect x="14" y="14" width="${SIZE - 28}" height="${SIZE - 28}" rx="84" ry="84"
        fill="none" stroke="#c79a49" stroke-width="6" stroke-opacity="0.55"/>
  <rect x="28" y="28" width="${SIZE - 56}" height="${SIZE - 56}" rx="74" ry="74"
        fill="url(#glow)"/>
  <g transform="translate(${SIZE / 2}, 438)">
    <rect x="-130" y="-26" width="260" height="52" rx="26" ry="26" fill="#841a2d"/>
    <text x="0" y="6" text-anchor="middle"
          font-family="'Segoe UI', 'Arial', sans-serif"
          font-size="22" font-weight="800" letter-spacing="6"
          fill="#fbecd0">STUDENT</text>
  </g>
</svg>`;

const ADMIN_BG_SVG = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a52138"/>
      <stop offset="55%" stop-color="#841a2d"/>
      <stop offset="100%" stop-color="#5a1220"/>
    </linearGradient>
    <radialGradient id="ring" cx="50%" cy="44%" r="56%">
      <stop offset="0%" stop-color="#ffe8c5" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffe8c5" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="96" ry="96" fill="url(#bg)"/>
  <rect x="14" y="14" width="${SIZE - 28}" height="${SIZE - 28}" rx="84" ry="84"
        fill="none" stroke="#f3d39a" stroke-width="6" stroke-opacity="0.85"/>
  <rect x="28" y="28" width="${SIZE - 56}" height="${SIZE - 56}" rx="74" ry="74"
        fill="url(#ring)"/>
  <circle cx="${SIZE / 2}" cy="232" r="190" fill="#fffdf9" opacity="0.97"/>
  <g transform="translate(${SIZE / 2}, 438)">
    <rect x="-130" y="-26" width="260" height="52" rx="26" ry="26"
          fill="#fbecd0" stroke="#c79a49" stroke-width="3"/>
    <text x="0" y="6" text-anchor="middle"
          font-family="'Segoe UI', 'Arial', sans-serif"
          font-size="22" font-weight="800" letter-spacing="6"
          fill="#841a2d">ADMIN</text>
  </g>
</svg>`;

async function build({ name, bgSvg, emblemSize }) {
  const emblem = await sharp(EMBLEM_SRC)
    .resize({ width: emblemSize, height: emblemSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const composed = await sharp(Buffer.from(bgSvg))
    .composite([{ input: emblem, gravity: "north", top: 70, left: Math.round((SIZE - emblemSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const out512 = path.join(OUT_DIR, `app-icon-${name}-512.png`);
  const out192 = path.join(OUT_DIR, `app-icon-${name}-192.png`);
  fs.writeFileSync(out512, composed);
  await sharp(composed).resize(192, 192).png({ compressionLevel: 9 }).toFile(out192);
  console.log(`✓ ${name}: ${out512}`);
  console.log(`✓ ${name}: ${out192}`);
}

(async () => {
  await build({ name: "student", bgSvg: STUDENT_BG_SVG, emblemSize: EMBLEM_SIZE });
  await build({ name: "admin", bgSvg: ADMIN_BG_SVG, emblemSize: EMBLEM_SIZE });
  console.log("\nDone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
