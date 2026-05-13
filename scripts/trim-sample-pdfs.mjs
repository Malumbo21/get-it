#!/usr/bin/env node
/**
 * scripts/trim-sample-pdfs.mjs
 *
 * Removes the last two pages from every PDF under public/pdfs. The
 * sample generator (scripts/generate-sample-pdfs.ts) used to tack
 * two blank/filler pages onto each textbook; those pages add nothing
 * for the demo and waste detection passes. Run once, commit the
 * resulting smaller PDFs.
 *
 *   node scripts/trim-sample-pdfs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const PDFS_DIR = path.join(REPO_ROOT, "public", "pdfs");

const SAMPLES = [
  "anatomy.pdf",
  "physics.pdf",
  "costituzione.pdf",
  "calculus.pdf",
  "chemistry.pdf",
];

for (const name of SAMPLES) {
  const filepath = path.join(PDFS_DIR, name);
  if (!fs.existsSync(filepath)) {
    console.warn(`[trim] skip ${name} — file missing`);
    continue;
  }
  const buf = fs.readFileSync(filepath);
  const src = await PDFDocument.load(buf);
  const total = src.getPageCount();
  if (total <= 2) {
    console.warn(`[trim] skip ${name} — only ${total} page(s)`);
    continue;
  }
  const trimmed = await PDFDocument.create();
  const indices = Array.from({ length: total - 2 }, (_, i) => i);
  const copied = await trimmed.copyPages(src, indices);
  for (const p of copied) trimmed.addPage(p);
  const out = await trimmed.save();
  fs.writeFileSync(filepath, out);
  console.log(`[trim] ${name}: ${total} → ${total - 2} pages`);
}

console.log("[trim] done.");
