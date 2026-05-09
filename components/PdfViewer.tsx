"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Box, Activity, FileText, Sigma, BarChart3, Loader2 } from "lucide-react";
import type { VizType } from "@/lib/schemas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

const TYPE_ICON: Record<VizType, React.ComponentType<{ className?: string }>> = {
  "3d": Box,
  "2d-anim": Activity,
  "2d-text": FileText,
  formula: Sigma,
  graph: BarChart3,
};

const TYPE_COLORS: Record<VizType, string> = {
  "3d": "from-rose-500 to-fuchsia-600",
  "2d-anim": "from-amber-400 to-orange-500",
  "2d-text": "from-emerald-400 to-teal-500",
  formula: "from-violet-400 to-indigo-500",
  graph: "from-sky-400 to-cyan-500",
};

export type Tag = {
  id: string;
  page: number; // 0-based
  endX: number;
  endY: number;
  fontHeight: number;
  type: VizType;
  label: string;
  /** Spec arrived — clicking opens the visualization. */
  ready: boolean;
  /** Currently fetching the spec — show spinner, disable click. */
  generating: boolean;
};

type Props = {
  pdfUrl: string;
  numPages: number;
  pageDims: Array<{ width: number; height: number }>;
  tags: Tag[];
  activeTagId: string | null;
  onTagClick: (tagId: string) => void;
  detecting?: boolean;
};

export default function PdfViewer({
  pdfUrl,
  numPages,
  pageDims,
  tags,
  activeTagId,
  onTagClick,
  detecting,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url: pdfUrl });
    task.promise.then((pdf) => {
      if (cancelled) {
        pdf.destroy();
        return;
      }
      setPdfDoc(pdf);
    });
    return () => {
      cancelled = true;
      task.promise.then((p) => p?.destroy?.()).catch(() => {});
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const measure = () => setContainerW(el.clientWidth - 64); // minus px padding
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Choose a uniform scale based on the widest page so all pages line up.
  const scale = useMemo(() => {
    if (!containerW || !pageDims.length) return 1;
    const widest = Math.max(...pageDims.map((p) => p.width));
    const target = Math.min(940, containerW);
    return target / widest;
  }, [containerW, pageDims]);

  // When the active tag changes, scroll to the page that contains it.
  useEffect(() => {
    if (!activeTagId || !scrollRef.current) return;
    const tag = tags.find((t) => t.id === activeTagId);
    if (!tag) return;
    const el = scrollRef.current.querySelector(`[data-page="${tag.page}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeTagId, tags]);

  return (
    <div ref={scrollRef} className="relative flex h-full flex-col overflow-y-auto bg-slate-100">
      {detecting && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200/70 bg-white/80 px-4 py-2 text-xs text-slate-600 backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-500" />
          codex is reading your document and tagging concepts…
        </div>
      )}
      <div className="flex flex-col items-center gap-6 px-6 py-6">
        {Array.from({ length: numPages }).map((_, i) => (
          <PdfPage
            key={i}
            pdfDoc={pdfDoc}
            pageNumber={i + 1}
            pdfWidth={pageDims[i]?.width ?? 595}
            pdfHeight={pageDims[i]?.height ?? 842}
            scale={scale}
            tags={tags.filter((t) => t.page === i)}
            activeTagId={activeTagId}
            onTagClick={onTagClick}
          />
        ))}
      </div>
    </div>
  );
}

function PdfPage({
  pdfDoc,
  pageNumber,
  pdfWidth,
  pdfHeight,
  scale,
  tags,
  activeTagId,
  onTagClick,
}: {
  pdfDoc: PDFDocumentProxy | null;
  pageNumber: number;
  pdfWidth: number;
  pdfHeight: number;
  scale: number;
  tags: Tag[];
  activeTagId: string | null;
  onTagClick: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!pdfDoc || !scale || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) {
        page.cleanup();
        return;
      }
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvas, canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        /* cancelled */
      }
      page.cleanup();
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {}
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div
      data-page={pageNumber - 1}
      className="relative shrink-0 rounded-lg bg-white shadow-[0_2px_30px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/70"
      style={{
        width: pdfWidth * scale,
        height: pdfHeight * scale,
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded-lg" />
      {/* Tag overlay layer */}
      <div className="pointer-events-none absolute inset-0">
        {tags.map((t) => {
          const Icon = TYPE_ICON[t.type];
          const left = t.endX * scale + 4;
          const top = (pdfHeight - t.endY - t.fontHeight * 0.85) * scale - 1;
          const isActive = activeTagId === t.id;
          // Three states: ready (clickable, colored), generating (disabled,
          // spinner), idle (clickable in manual mode — colored but lighter).
          const isIdle = !t.ready && !t.generating;
          const clickable = t.ready || isIdle;
          let baseClass: string;
          let title: string;
          if (t.ready) {
            baseClass = `bg-gradient-to-br ${TYPE_COLORS[t.type]} text-white ring-white/40 hover:scale-105 hover:shadow-lg cursor-pointer`;
            title = t.label;
          } else if (t.generating) {
            baseClass = "cursor-wait bg-slate-200 text-slate-500 ring-slate-300";
            title = "preparing visualization…";
          } else {
            // Idle / manual mode — clickable but visually softer.
            baseClass = `bg-gradient-to-br ${TYPE_COLORS[t.type]} text-white/90 ring-white/30 opacity-75 hover:opacity-100 hover:scale-105 hover:shadow-lg cursor-pointer`;
            title = `Click to generate visualization for "${t.label}"`;
          }
          return (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, y: -4, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.25 }}
              type="button"
              disabled={!clickable}
              onClick={() => onTagClick(t.id)}
              style={{ left, top }}
              className={[
                "pointer-events-auto absolute -translate-y-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-none shadow-md ring-1 transition-all",
                baseClass,
                isActive && "scale-110 ring-2 ring-white opacity-100",
              ]
                .filter(Boolean)
                .join(" ")}
              title={title}
            >
              {t.generating ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Icon className="h-2.5 w-2.5" />
              )}
              <span className="max-w-[160px] truncate">{t.label}</span>
            </motion.button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute -bottom-5 right-2 text-[10px] text-slate-400">
        page {pageNumber}
      </div>
    </div>
  );
}
