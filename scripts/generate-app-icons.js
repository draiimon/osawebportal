"use strict";

// Generates two app icons (student + admin) by compositing the EAC emblem
// over distinct branded backgrounds. The emblem itself is never modified.
// Outputs 1024, 512, and 192 px PNGs for both variants.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const EMBLEM_SRC = path.join(ROOT, "public", "assets", "images", "eac-emblem-large.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "images");

const SIZE = 1024;
const PADDING = 56;                // outer rounded-square inset
const RIBBON_W = 520;
const RIBBON_H = 104;
const RIBBON_Y = 880;              // y-center of the badge ribbon
const EMBLEM_SIZE = 720;           // emblem dimensions inside the canvas
const EMBLEM_TOP = 130;            // distance from top to emblem
const CORNER = 192;                // outer corner radius (for app-icon look)

const studentSvg = `
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
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}" fill="url(#bg)"/>
  <rect x="28" y="28" width="${SIZE - 56}" height="${SIZE - 56}" rx="${CORNER - 12}" ry="${CORNER - 12}"
        fill="none" stroke="#c79a49" stroke-width="12" stroke-opacity="0.55"/>
  <rect x="${PADDING}" y="${PADDING}" width="${SIZE - PADDING * 2}" height="${SIZE - PADDING * 2}"
        rx="${CORNER - 24}" ry="${CORNER - 24}" fill="url(#glow)"/>
  <g transform="translate(${SIZE / 2}, ${RIBBON_Y})">
    <rect x="${-RIBBON_W / 2}" y="${-RIBBON_H / 2}" width="${RIBBON_W}" height="${RIBBON_H}"
          rx="${RIBBON_H / 2}" ry="${RIBBON_H / 2}" fill="#841a2d"/>
    <text x="0" y="14" text-anchor="middle"
          font-family="'Segoe UI', 'Arial', sans-serif"
          font-size="44" font-weight="800" letter-spacing="12"
          fill="#fbecd0">STUDENT</text>
  </g>
</svg>`;

const adminSvg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a52138"/>
      <stop offset="55%" stop-color="#841a2d"/>
      <stop offset="100%" stop-color="#5a1220"/>
    </linearGradient>
    <radialGradient id="ring" cx="50%" cy="44%" r="56%">
      <stop offset="0%" stop-color="#ffe8c5" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#ffe8c5" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}" fill="url(#bg)"/>
  <rect x="28" y="28" width="${SIZE - 56}" height="${SIZE - 56}" rx="${CORNER - 12}" ry="${CORNER - 12}"
        fill="none" stroke="#f3d39a" stroke-width="12" stroke-opacity="0.85"/>
  <rect x="${PADDING}" y="${PADDING}" width="${SIZE - PADDING * 2}" height="${SIZE - PADDING * 2}"
        rx="${CORNER - 24}" ry="${CORNER - 24}" fill="url(#ring)"/>
  <circle cx="${SIZE / 2}" cy="${EMBLEM_TOP + EMBLEM_SIZE / 2}" r="${EMBLEM_SIZE / 2 + 24}"
          fill="#fffdf9" opacity="0.97"/>
  <g transform="translate(${SIZE / 2}, ${RIBBON_Y})">
    <rect x="${-RIBBON_W / 2}" y="${-RIBBON_H / 2}" width="${RIBBON_W}" height="${RIBBON_H}"
          rx="${RIBBON_H / 2}" ry="${RIBBON_H / 2}" fill="#fbecd0" stroke="#c79a49" stroke-width="6"/>
    <text x="0" y="14" text-anchor="middle"
          font-family="'Segoe UI', 'Arial', sans-serif"
          font-size="44" font-weight="800" letter-spacing="12"
          fill="#841a2d">ADMIN</text>
  </g>
</svg>`;

async function build({ name, bgSvg }) {
  const emblem = await sharp(EMBLEM_SRC)
    .resize({
      width: EMBLEM_SIZE,
      height: EMBLEM_SIZE,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const composed = await sharp(Buffer.from(bgSvg))
    .composite([
      {
        input: emblem,
        top: EMBLEM_TOP,
        left: Math.round((SIZE - EMBLEM_SIZE) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const out1024 = path.join(OUT_DIR, `app-icon-${name}-1024.png`);
  const out512 = path.join(OUT_DIR, `app-icon-${name}-512.png`);
  const out192 = path.join(OUT_DIR, `app-icon-${name}-192.png`);
  const out180 = path.join(OUT_DIR, `app-icon-${name}-180.png`);
  const out167 = path.join(OUT_DIR, `app-icon-${name}-167.png`);
  const out152 = path.join(OUT_DIR, `app-icon-${name}-152.png`);
  const out120 = path.join(OUT_DIR, `app-icon-${name}-120.png`);

  // Flatten alpha channel — iOS rejects icons with transparency on the home
  // screen and renders them with a white square halo if any pixels are
  // transparent. Force solid white background.
  const flattened = await sharp(composed)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(out1024, flattened);
  await sharp(flattened).resize(512, 512).png({ compressionLevel: 9 }).toFile(out512);
  await sharp(flattened).resize(192, 192).png({ compressionLevel: 9 }).toFile(out192);
  await sharp(flattened).resize(180, 180).png({ compressionLevel: 9 }).toFile(out180);
  await sharp(flattened).resize(167, 167).png({ compressionLevel: 9 }).toFile(out167);
  await sharp(flattened).resize(152, 152).png({ compressionLevel: 9 }).toFile(out152);
  await sharp(flattened).resize(120, 120).png({ compressionLevel: 9 }).toFile(out120);

  console.log(`✓ ${name}: 1024, 512, 192, 180, 167, 152, 120 written.`);
}

(async () => {
  await build({ name: "student", bgSvg: studentSvg });
  await build({ name: "admin", bgSvg: adminSvg });
  console.log("\nDone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
