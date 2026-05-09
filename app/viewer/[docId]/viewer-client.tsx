"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, RefreshCw, AlertCircle, MousePointerClick } from "lucide-react";
import { motion } from "framer-motion";

import PdfViewer, { type Tag } from "@/components/PdfViewer";
import Visualizer from "@/components/Visualizer";
import type { DetectedConcept, VizSpec, VizType } from "@/lib/schemas";
import { AUTO_GENERATE_VIZ } from "@/lib/config";

const MAX_CONCURRENT_VIZ_GEN = 4;

type DocMeta = {
  docId: string;
  filename: string;
  pdfUrl: string;
  numPages: number;
  pages: Array<{ pageIndex: number; width: number; height: number; text: string }>;
};

type AnalyzeResult = {
  concepts: DetectedConcept[];
  anchors: Record<number, { endX: number; endY: number; fontHeight: number } | null>;
  pageWidth: number;
  pageHeight: number;
};

type TagState = Tag & {
  concept: DetectedConcept;
  spec?: VizSpec;
  error?: string;
};

const FILENAME_TO_TITLE: Record<string, string> = {
  "anatomy.pdf": "Anatomy & Physiology",
  "physics.pdf": "Classical Mechanics",
  "costituzione.pdf": "Costituzione Italiana",
  "calculus.pdf": "Differential & Integral Calculus",
  "chemistry.pdf": "Organic Chemistry",
};

export default function ViewerClient({ docId }: { docId: string }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tags, setTags] = useState<TagState[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [pagesAnalyzing, setPagesAnalyzing] = useState<Set<number>>(new Set());
  const [pagesAnalyzed, setPagesAnalyzed] = useState<Set<number>>(new Set());

  // ── Load document metadata ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/doc/${docId}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(
            r.status === 404
              ? "This document is no longer in memory. Please re-upload from the home page."
              : `Could not load document (HTTP ${r.status})`,
          );
        }
        return (await r.json()) as DocMeta;
      })
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const docTitle = useMemo(
    () => meta && (FILENAME_TO_TITLE[meta.filename] || meta.filename.replace(/\.pdf$/i, "")),
    [meta],
  );

  // ── Refs that survive re-renders for the orchestration plumbing ──────
  const analyzedRef = useRef<Set<number>>(new Set());
  const vizQueueRef = useRef<TagState[]>([]);
  const vizInflightRef = useRef(0);
  // Tracks tag IDs that are currently queued OR inflight, so we never
  // double-enqueue a manual click.
  const enqueuedRef = useRef<Set<string>>(new Set());
  const ctrlsRef = useRef<AbortController[]>([]);
  const cancelledRef = useRef(false);

  // ── Helpers ──────────────────────────────────────────────────────────
  const pumpVizQueue = useCallback(() => {
    while (
      vizInflightRef.current < MAX_CONCURRENT_VIZ_GEN &&
      vizQueueRef.current.length
    ) {
      const next = vizQueueRef.current.shift()!;
      vizInflightRef.current++;
      const ctrl = new AbortController();
      ctrlsRef.current.push(ctrl);
      fetch("/api/generate-viz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: next.type,
          label: next.concept.label,
          context: next.concept.context,
          docTitle,
        }),
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error(`generate-viz ${r.status}: ${txt.slice(0, 200)}`);
          }
          return (await r.json()) as VizSpec;
        })
        .then((spec) => {
          if (cancelledRef.current) return;
          setTags((prev) =>
            prev.map((t) =>
              t.id === next.id ? { ...t, spec, ready: true, generating: false } : t,
            ),
          );
        })
        .catch((e) => {
          if (
            cancelledRef.current ||
            ctrl.signal.aborted ||
            (e as Error).name === "AbortError" ||
            ((e as Error).message || "").includes("Failed to fetch")
          ) {
            return;
          }
          console.error("viz generation error for", next.label, e);
          setTags((prev) =>
            prev.map((t) =>
              t.id === next.id
                ? { ...t, error: (e as Error).message, ready: false, generating: false }
                : t,
            ),
          );
        })
        .finally(() => {
          enqueuedRef.current.delete(next.id);
          vizInflightRef.current--;
          if (!cancelledRef.current) pumpVizQueue();
        });
    }
  }, [docTitle]);

  const enqueueTagForGen = useCallback(
    (tag: TagState) => {
      if (enqueuedRef.current.has(tag.id)) return;
      if (tag.spec || tag.error) return;
      enqueuedRef.current.add(tag.id);
      vizQueueRef.current.push(tag);
      // Mark the tag as generating so the pill shows the spinner.
      setTags((prev) =>
        prev.map((t) => (t.id === tag.id ? { ...t, generating: true } : t)),
      );
      pumpVizQueue();
    },
    [pumpVizQueue],
  );

  // ── Page-by-page concept detection ───────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    cancelledRef.current = false;

    async function runOne(pageIndex: number) {
      if (analyzedRef.current.has(pageIndex)) return;
      analyzedRef.current.add(pageIndex);
      setPagesAnalyzing((s) => new Set(s).add(pageIndex));
      const ctrl = new AbortController();
      ctrlsRef.current.push(ctrl);
      try {
        const r = await fetch("/api/analyze-pdf", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId, pageIndex }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`analyze failed ${r.status}`);
        const j = (await r.json()) as AnalyzeResult;
        if (cancelledRef.current) return;
        const newTags: TagState[] = j.concepts
          .map((c, i) => {
            const a = j.anchors[i];
            if (!a) return null;
            return {
              id: `${pageIndex}-${i}`,
              page: pageIndex,
              endX: a.endX,
              endY: a.endY,
              fontHeight: a.fontHeight,
              type: c.type as VizType,
              label: c.label,
              ready: false,
              generating: AUTO_GENERATE_VIZ,
              concept: c,
            };
          })
          .filter((t): t is TagState => t !== null);
        setTags((prev) => [...prev, ...newTags]);
        // In auto mode, eagerly queue every tag for generation. In manual
        // mode, wait for the user to click.
        if (AUTO_GENERATE_VIZ) {
          for (const t of newTags) {
            enqueuedRef.current.add(t.id);
            vizQueueRef.current.push(t);
          }
          pumpVizQueue();
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        console.error(`page ${pageIndex} analyze error`, e);
      } finally {
        if (!cancelledRef.current) {
          setPagesAnalyzing((s) => {
            const n = new Set(s);
            n.delete(pageIndex);
            return n;
          });
          setPagesAnalyzed((s) => new Set(s).add(pageIndex));
        }
      }
    }

    // Run pages in parallel, but cap concurrency at 3 to avoid hammering codex.
    const queue = Array.from({ length: meta.numPages }, (_, i) => i);
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const idx = queue.shift();
        if (idx == null) return;
        await runOne(idx);
      }
    });
    Promise.all(workers).catch(() => {});

    return () => {
      cancelledRef.current = true;
      vizQueueRef.current = [];
      enqueuedRef.current.clear();
      ctrlsRef.current.forEach((c) => {
        try {
          c.abort();
        } catch {}
      });
      ctrlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, docId]);

  const activeTag = tags.find((t) => t.id === activeTagId) ?? null;
  const activeSpec = activeTag?.spec ?? null;

  // Auto-select the first ready tag the moment it becomes ready, so the
  // visualizer panel isn't empty when the user is waiting for tags. In
  // manual mode no tag is ever auto-generated, so this naturally no-ops
  // until the user clicks something.
  useEffect(() => {
    if (activeTagId) return;
    const firstReady = tags.find((t) => t.ready);
    if (firstReady) setActiveTagId(firstReady.id);
  }, [tags, activeTagId]);

  const handleTagClick = useCallback(
    (id: string) => {
      setActiveTagId(id);
      const tag = tags.find((t) => t.id === id);
      if (!tag) return;
      // In auto mode, generation is already in flight or done. In manual
      // mode the click itself triggers generation for this specific tag.
      if (!tag.spec && !tag.error && !tag.generating) {
        enqueueTagForGen(tag);
      }
    },
    [tags, enqueueTagForGen],
  );

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-white">
        <AlertCircle className="h-7 w-7 text-rose-400" />
        <p className="text-sm text-white/80">{loadError}</p>
        <Link
          href="/"
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
        >
          Back to upload
        </Link>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white/60">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> loading document…
      </div>
    );
  }

  const detecting = pagesAnalyzing.size > 0;
  const totalPages = meta.numPages;
  const doneCount = pagesAnalyzed.size;
  const tagReadyCount = tags.filter((t) => t.ready).length;
  const tagGeneratingCount = tags.filter((t) => t.generating).length;

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-950/80 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
          <div className="flex items-center gap-2 text-white/80">
            <FileText className="h-4 w-4 text-white/40" />
            <p className="truncate text-sm font-medium">{docTitle ?? meta.filename}</p>
            <span className="text-xs text-white/40">· {meta.numPages} pages</span>
          </div>
          {!AUTO_GENERATE_VIZ && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
              <MousePointerClick className="h-3 w-3" /> manual mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-white/55">
          <ProgressChip
            label="pages analyzed"
            value={doneCount}
            total={totalPages}
            spinning={detecting}
          />
          <ProgressChip
            label={AUTO_GENERATE_VIZ ? "visualizations ready" : "tags clicked"}
            value={tagReadyCount}
            total={AUTO_GENERATE_VIZ ? tags.length : tagReadyCount + tagGeneratingCount}
            spinning={tagGeneratingCount > 0}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-white/10">
          <PdfViewer
            pdfUrl={meta.pdfUrl}
            numPages={meta.numPages}
            pageDims={meta.pages.map((p) => ({ width: p.width, height: p.height }))}
            tags={tags}
            activeTagId={activeTagId}
            onTagClick={handleTagClick}
            detecting={detecting}
          />
        </div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-[44%] min-w-[420px] max-w-[720px] bg-gradient-to-br from-slate-900 via-slate-950 to-black"
        >
          <Visualizer
            spec={activeSpec}
            loading={activeTag != null && !activeTag.spec && !activeTag.error}
            emptyHint={
              tags.length === 0
                ? "codex is reading the document — tags will appear inline as soon as they're detected."
                : AUTO_GENERATE_VIZ
                  ? "Click any colored tag in the document to render its concept here."
                  : "Click any tag to generate its visualization. (manual mode is on — see .env)"
            }
          />
          {activeTag?.error && (
            <div className="border-t border-rose-500/30 bg-rose-950/40 px-5 py-3 text-xs text-rose-200">
              {activeTag.error}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function ProgressChip({
  label,
  value,
  total,
  spinning,
}: {
  label: string;
  value: number;
  total: number;
  spinning?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1">
      {spinning && <RefreshCw className="h-3 w-3 animate-spin text-fuchsia-300" />}
      <span className="tabular-nums text-white/85">
        {value}
        <span className="text-white/40">/{total}</span>
      </span>
      <span className="text-white/45">{label}</span>
    </div>
  );
}
