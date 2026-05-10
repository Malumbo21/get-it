/**
 * GET /api/kg/[docId]/state — fetch the current knowledge graph for a doc.
 *
 * Returns 200 with status="missing" if the graph hasn't been built yet, so
 * the client can render the empty state without hitting an HTTP error path.
 */

import { NextResponse } from "next/server";
import { emptyKG, loadKG } from "@/lib/kg";
import { getDoc } from "@/lib/store";
import { isEvaluating } from "@/lib/kg-runner";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const kg = loadKG(docId) ?? emptyKG(docId);
  return NextResponse.json({ ...kg, evaluating: isEvaluating(docId) });
}
