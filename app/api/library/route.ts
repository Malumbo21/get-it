/**
 * GET    /api/library          → [{ id, filename, …, kgStatus, tagsState }]
 * DELETE /api/library?id=...   → remove a doc from the library (PDF, workctx, KG, tags)
 *
 * The Library page renders this list. We enrich each row with cheap
 * signals so the user gets a real "where was I" view:
 *   - lastActivityAt: max(uploadedAt, workctx.savedAt-ish, kg.lastEvaluatedAt)
 *   - kgStatus + kgEvaluationCount: from the on-disk KG file (or "missing")
 *   - tagsAnalyzedPages + tagsTotal + tagsReady: from the on-disk
 *     tags.json, mirroring the two-phase TagsChip in the viewer (page
 *     scan progress, then visualization-ready count).
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import { deleteDoc, listDocs, type DocMeta } from "@/lib/store";
import { kgPath, workCtxPath } from "@/lib/paths";
import { loadKG } from "@/lib/kg";
import { loadTags } from "@/lib/tags-store";

export const runtime = "nodejs";

function statMtime(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

type LibraryRow = DocMeta & {
  lastActivityAt: number;
  kgStatus: "missing" | "building" | "ready" | "error";
  kgEvaluationCount: number;
  // null when the doc was never opened in the viewer yet (no tags.json
  // on disk). When non-null, the trio mirrors the viewer's TagsChip.
  tagsAnalyzedPages: number | null;
  tagsTotal: number | null;
  tagsReady: number | null;
};

export async function GET() {
  const docs = listDocs();
  const rows: LibraryRow[] = docs.map((d) => {
    const wcMtime = statMtime(workCtxPath(d.id));
    const kgMtime = statMtime(kgPath(d.id));
    const kg = loadKG(d.id);
    const tags = loadTags(d.id);
    const lastActivityAt = Math.max(
      d.uploadedAt,
      wcMtime ?? 0,
      kgMtime ?? 0,
      kg?.lastEvaluatedAt ?? 0,
    );
    return {
      ...d,
      lastActivityAt,
      kgStatus: kg?.status ?? "missing",
      kgEvaluationCount: kg?.evaluationCount ?? 0,
      tagsAnalyzedPages: tags ? tags.pagesAnalyzed.length : null,
      tagsTotal: tags ? tags.tags.length : null,
      tagsReady: tags ? tags.tags.filter((t) => t.ready).length : null,
    };
  });
  return NextResponse.json({ docs: rows });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  const ok = deleteDoc(id);
  return NextResponse.json({ ok });
}
