#!/usr/bin/env node
/**
 * scripts/build-icon.mjs
 *
 * Renders the Get It. app icon (a black "Get It." wordmark on a white
 * square) to PNG, ICNS and ICO files inside electron/assets/. The PNG
 * is the master; electron-builder uses it directly for Linux and falls
 * back to it for macOS/Windows when no platform-specific file is set,
 * but we still produce the .icns / .ico for cleaner builds.
 *
 * The wordmark mirrors the home-page headline: same family (system
 * sans-serif), same font-black weight, same tracking. Pure ink-900
 * (#111113) on pure surface-canvas (#ffffff).
 *
 * Run after `npm install`, or when the wordmark needs a refresh:
 *
 *   node scripts/build-icon.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const OUT_DIR = path.join(REPO_ROOT, "electron", "assets");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZE_PNG = 1024;
const BG = "#ffffff";
const FG = "#111113";

// ── Render one square wordmark PNG ──────────────────────────────────────
function renderWordmark(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // Two-line stacked layout reads cleanly at both 1024×1024 and 16×16:
  //   GET IT
  //      .
  // …but we want the literal "Get It." wordmark, so we render a single
  // line and let it fill ~78% of the icon width. At very small sizes
  // (Dock tile 16-32px) anti-aliasing will collapse the letters into a
  // recognisable shape pattern, the wordmark is still distinct from
  // plain text icons.
  //
  // Font: system sans-serif at the heaviest weight available, matching
  // the home-page headline. Slight negative tracking keeps the wordmark
  // compact.
  const text = "Get It.";
  ctx.fillStyle = FG;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // Pick a font size that fits ~84% of the icon width — leaves ~8%
  // padding on each side, which reads as "comfortable" on dock tiles
  // and Launchpad cells.
  let fontPx = Math.floor(size * 0.5);
  const family =
    'system-ui, -apple-system, "Helvetica Neue", "Inter", Arial, sans-serif';
  const targetWidth = size * 0.84;
  while (fontPx > 8) {
    ctx.font = `900 ${fontPx}px ${family}`;
    const w = ctx.measureText(text).width;
    if (w <= targetWidth) break;
    fontPx -= 4;
  }

  // Tighten tracking visually by drawing each glyph slightly closer.
  // Canvas doesn't expose letter-spacing; we redraw glyph-by-glyph with
  // a manual offset proportional to the font size.
  const TRACK = -0.012 * fontPx;
  const glyphs = [...text];
  ctx.font = `900 ${fontPx}px ${family}`;
  const widths = glyphs.map((g) => ctx.measureText(g).width);
  const total = widths.reduce((a, b) => a + b, 0) + TRACK * (glyphs.length - 1);
  let cursor = (size - total) / 2;
  // Optical centering: text bounding box has uneven white space above
  // and below the visual mass because capital letters sit high. Use
  // actualBoundingBox metrics to centre the *visual* glyphs, not the
  // typographic baseline.
  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent;
  const descent = m.actualBoundingBoxDescent;
  const visualHeight = ascent + descent;
  // Anchor the visual centre to the icon's vertical centre.
  const baselineY = size / 2 + (descent - ascent) / 2;
  void visualHeight; // (kept for documentation)
  for (let i = 0; i < glyphs.length; i++) {
    ctx.textAlign = "left";
    ctx.fillText(glyphs[i], cursor, baselineY);
    cursor += widths[i] + TRACK;
  }

  return c.toBuffer("image/png");
}

// ── Write the master PNG ────────────────────────────────────────────────
const pngBuf = renderWordmark(SIZE_PNG);
const pngPath = path.join(OUT_DIR, "icon.png");
fs.writeFileSync(pngPath, pngBuf);
console.log(`[build-icon] wrote ${pngPath} (${pngBuf.length} bytes)`);

// ── Derive .icns (macOS) and .ico (Windows) when the tools are around ──
//
// On macOS we use `iconutil` + `sips` — both ship with the OS. On Linux
// CI runners we lean on `png2icns` if installed. We never hard-fail if
// the helpers are missing: electron-builder can still consume the PNG
// alone and generate per-platform icons on the fly.
function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function buildIcnsMac() {
  const sips = which("sips");
  const iconutil = which("iconutil");
  if (!sips || !iconutil) return false;
  // iconutil only accepts directories ending in ".iconset" — so we use a
  // deterministic name and clean up at the end.
  const iconsetDir = path.join(OUT_DIR, "icon.iconset");
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  try {
    // Sizes Apple expects in an .icns iconset.
    const variants = [
      [16, "icon_16x16.png"],
      [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"],
      [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"],
      [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"],
      [512, "icon_256x256@2x.png"],
      [512, "icon_512x512.png"],
      [1024, "icon_512x512@2x.png"],
    ];
    for (const [px, name] of variants) {
      const dst = path.join(iconsetDir, name);
      // Re-render at the right pixel size so small icons keep crisp
      // glyphs instead of just downscaling 1024×1024.
      const buf = renderWordmark(px);
      fs.writeFileSync(dst, buf);
    }
    const out = path.join(OUT_DIR, "icon.icns");
    execSync(`iconutil -c icns "${iconsetDir}" -o "${out}"`, {
      stdio: "inherit",
    });
    console.log(`[build-icon] wrote ${out}`);
    return true;
  } finally {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }
}

function buildIcoWindows() {
  // Multi-resolution .ico file. The format is a directory of PNG-or-BMP
  // entries; we ship PNG entries at 16/32/48/64/128/256, which Windows
  // 10/11 read fine.
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => renderWordmark(s));
  const headerSize = 6 + 16 * sizes.length;
  let offset = headerSize;
  const entries = sizes.map((s, i) => {
    const entry = {
      width: s === 256 ? 0 : s,
      height: s === 256 ? 0 : s,
      colors: 0,
      reserved: 0,
      planes: 1,
      bpp: 32,
      size: pngs[i].length,
      offset,
    };
    offset += pngs[i].length;
    return entry;
  });

  const buf = Buffer.alloc(headerSize);
  // ICONDIR header: reserved=0, type=1 (icon), count
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(sizes.length, 4);
  let p = 6;
  for (const e of entries) {
    buf.writeUInt8(e.width, p);
    buf.writeUInt8(e.height, p + 1);
    buf.writeUInt8(e.colors, p + 2);
    buf.writeUInt8(e.reserved, p + 3);
    buf.writeUInt16LE(e.planes, p + 4);
    buf.writeUInt16LE(e.bpp, p + 6);
    buf.writeUInt32LE(e.size, p + 8);
    buf.writeUInt32LE(e.offset, p + 12);
    p += 16;
  }
  const out = path.join(OUT_DIR, "icon.ico");
  fs.writeFileSync(out, Buffer.concat([buf, ...pngs]));
  console.log(`[build-icon] wrote ${out}`);
}

try {
  if (process.platform === "darwin") buildIcnsMac();
} catch (e) {
  console.warn("[build-icon] icns generation failed:", e.message);
}
try {
  buildIcoWindows();
} catch (e) {
  console.warn("[build-icon] ico generation failed:", e.message);
}

console.log("[build-icon] done.");
