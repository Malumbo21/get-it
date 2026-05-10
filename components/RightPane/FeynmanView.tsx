"use client";

/**
 * Feynman method.
 *
 * The user explains a topic in plain language. The agent asks short guided
 * questions that expose unclear parts, then the session ends with feedback.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Lightbulb,
  MessageCircleQuestionMark,
  PencilLine,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { FeynmanSession } from "@/lib/work-context-types";
import { consumePrefill } from "./prefill";

type Props = { docId: string };

type StartResp = {
  session: FeynmanSession;
  childPrompt: string;
  done: false;
  maxTurns: number;
};
type ExplainResp =
  | { session: FeynmanSession; childPrompt: string; done: false; maxTurns: number }
  | { session: FeynmanSession; done: true; summary: string; maxTurns: number };

export default function FeynmanView({ docId }: Props) {
  const [sessions, setSessions] = useState<FeynmanSession[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [pendingChildPrompt, setPendingChildPrompt] = useState<string | null>(null);
  const [pendingBySession, setPendingBySession] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxTurns, setMaxTurns] = useState(4);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/feynman/${docId}`)
      .then((r) => r.json())
      .then((j: { sessions: FeynmanSession[]; maxTurns: number }) => {
        if (cancelled) return;
        setSessions(j.sessions);
        setMaxTurns(j.maxTurns);
        const prefill = consumePrefill(docId, "feynman");
        if (prefill) setTopic(prefill);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const active = sessions?.find((s) => s.id === activeId) ?? null;

  const start = useCallback(async () => {
    const t = topic.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/feynman/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", topic: t }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`start failed (${r.status}): ${txt.slice(0, 120)}`);
      }
      const j = (await r.json()) as StartResp;
      setSessions((prev) => [j.session, ...(prev ?? [])]);
      setActiveId(j.session.id);
      setPendingChildPrompt(j.childPrompt);
      setPendingBySession((prev) => ({ ...prev, [j.session.id]: j.childPrompt }));
      setDraft("");
      setMaxTurns(j.maxTurns);
      setTopic("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [docId, topic]);

  const explain = useCallback(async () => {
    if (!active || !pendingChildPrompt) return;
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setSessions((prev) =>
      prev
        ? prev.map((s) =>
            s.id === active.id
              ? {
                  ...s,
                  turns: [
                    ...s.turns,
                    { childPrompt: pendingChildPrompt, userExplanation: text, ts: Date.now() },
                  ],
                }
              : s,
          )
        : prev,
    );
    setDraft("");
    setPendingChildPrompt(null);
    setPendingBySession((prev) => ({ ...prev, [active.id]: null }));
    try {
      const r = await fetch(`/api/feynman/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "explain",
          sessionId: active.id,
          userExplanation: text,
          childPrompt: pendingChildPrompt,
        }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`explain failed (${r.status}): ${txt.slice(0, 120)}`);
      }
      const j = (await r.json()) as ExplainResp;
      setSessions((prev) =>
        prev ? prev.map((s) => (s.id === active.id ? j.session : s)) : prev,
      );
      if (j.done) {
        setPendingBySession((prev) => ({ ...prev, [active.id]: null }));
      } else {
        setPendingChildPrompt(j.childPrompt);
        setPendingBySession((prev) => ({ ...prev, [active.id]: j.childPrompt }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [active, docId, draft, pendingChildPrompt]);

  const deleteSession = useCallback(
    async (id: string) => {
      await fetch(`/api/feynman/${docId}?sessionId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      setPendingBySession((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeId === id) {
        setActiveId(null);
        setPendingChildPrompt(null);
      }
    },
    [activeId, docId],
  );

  if (sessions === null) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-[var(--ink-500)]">
        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> loading...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
        <div className="m-2 rounded-md border border-[var(--border-subtle)] bg-white p-2 shadow-[0_1px_0_rgba(17,17,19,0.02)]">
          <div className="mb-2 flex items-center gap-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--accent-100)] bg-[var(--accent-50)] text-[var(--accent-700)]">
              <Lightbulb className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <label className="block text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-500)]">
                New session
              </label>
              <p className="truncate text-[10.5px] text-[var(--ink-400)]">Feynman method</p>
            </div>
          </div>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic to clarify"
            className="mb-2 w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] text-[var(--ink-900)] placeholder:text-[var(--ink-400)] focus:border-[var(--accent-500)] focus:outline-none"
            disabled={busy}
          />
          <button
            type="button"
            onClick={start}
            disabled={busy || !topic.trim()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--ink-900)] py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {busy ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> starting...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Start session
              </>
            )}
          </button>
          {error && <p className="mt-2 text-[11px] leading-relaxed text-rose-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-500)]">
          <span>Past sessions</span>
          <span className="tabular-nums text-[var(--ink-400)]">{sessions.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] leading-relaxed text-[var(--ink-400)]">
              No sessions yet. Pick a topic above and start with a plain-language explanation.
            </p>
          ) : (
            sessions.map((s) => (
              <SessionListItem
                key={s.id}
                session={s}
                active={activeId === s.id}
                maxTurns={maxTurns}
                onSelect={() => {
                  setActiveId(s.id);
                  setPendingChildPrompt(s.endedAt ? null : pendingBySession[s.id] ?? null);
                  setDraft("");
                }}
                onDelete={() => deleteSession(s.id)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-white">
        {!active ? (
          <EmptyHint
            icon={<Lightbulb className="h-7 w-7 text-[var(--ink-400)]" />}
            text="Choose a topic, then refine your explanation through short guided questions."
          />
        ) : (
          <ActiveSession
            session={active}
            pendingChildPrompt={pendingChildPrompt}
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onSend={explain}
            maxTurns={maxTurns}
          />
        )}
      </section>
    </div>
  );
}

function SessionListItem({
  session,
  active,
  maxTurns,
  onSelect,
  onDelete,
}: {
  session: FeynmanSession;
  active: boolean;
  maxTurns: number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const progress = Math.min(100, (session.turns.length / Math.max(1, maxTurns)) * 100);

  return (
    <div
      className={`group mb-1 rounded-md px-2 py-1.5 text-[11.5px] transition-colors ${
        active
          ? "bg-white text-[var(--ink-900)] shadow-[0_1px_0_rgba(17,17,19,0.04)]"
          : "text-[var(--ink-700)] hover:bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 truncate text-left font-medium"
          title={session.topic}
        >
          {session.topic}
        </button>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            session.endedAt
              ? "bg-emerald-500"
              : session.turns.length > 0
                ? "bg-[var(--accent-500)]"
                : "bg-[var(--ink-300)]"
          }`}
        />
        <button
          type="button"
          onClick={onDelete}
          className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--ink-400)] hover:bg-[var(--surface-sunken)] hover:text-rose-600 group-hover:visible"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <button type="button" onClick={onSelect} className="mt-1 block w-full text-left">
        <div className="mb-1 flex items-center justify-between text-[10.5px] text-[var(--ink-400)]">
          <span>
            {session.turns.length}/{maxTurns} turns
          </span>
          <span>{session.endedAt ? "done" : "in progress"}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--accent-500)] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </button>
    </div>
  );
}

function ActiveSession({
  session,
  pendingChildPrompt,
  draft,
  setDraft,
  busy,
  onSend,
  maxTurns,
}: {
  session: FeynmanSession;
  pendingChildPrompt: string | null;
  draft: string;
  setDraft: (s: string) => void;
  busy: boolean;
  onSend: () => void;
  maxTurns: number;
}) {
  const ended = session.endedAt != null;
  const progress = Math.min(100, (session.turns.length / Math.max(1, maxTurns)) * 100);

  const feedbackParts = useMemo(() => splitFeedback(session.summary), [session.summary]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-white px-5 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11.5px] text-[var(--ink-500)]">
          <span className="flex min-w-0 items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[var(--accent-600)]" />
            <span className="truncate">
              Feynman / <strong className="font-medium text-[var(--ink-900)]">{session.topic}</strong>
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            {session.turns.length}/{maxTurns}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--accent-500)] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {session.turns.length === 0 && pendingChildPrompt && !ended && (
            <QuestionCard label="Question 1" text={pendingChildPrompt} />
          )}

          {session.turns.map((t, i) => (
            <TimelineTurn
              key={`${t.ts}-${i}`}
              index={i}
              childPrompt={t.childPrompt}
              userExplanation={t.userExplanation}
            />
          ))}

          {pendingChildPrompt && !ended && session.turns.length > 0 && (
            <QuestionCard label={`Question ${session.turns.length + 1}`} text={pendingChildPrompt} />
          )}

          {!pendingChildPrompt && !ended && session.turns.length === 0 && busy && (
            <LoadingPrompt text="Preparing the first question..." />
          )}

          {!pendingChildPrompt && !ended && session.turns.length > 0 && busy && (
            <LoadingPrompt text="Preparing the next step..." />
          )}

          {!pendingChildPrompt && !ended && !busy && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--ink-500)]">
              This session is paused. Start a new one to continue with a fresh question.
            </div>
          )}

          {ended && (
            <FeedbackCard summary={session.summary} parts={feedbackParts} />
          )}
        </div>
      </div>

      {!ended && pendingChildPrompt && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="shrink-0 border-t border-[var(--border-subtle)] bg-white p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--ink-500)]">
            <PencilLine className="h-3.5 w-3.5" />
            Your explanation
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Explain it plainly..."
              rows={3}
              className="min-h-[70px] flex-1 resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] leading-relaxed text-[var(--ink-900)] placeholder:text-[var(--ink-400)] focus:border-[var(--accent-500)] focus:outline-none"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="flex h-[70px] w-[44px] items-center justify-center rounded-md bg-[var(--ink-900)] text-white hover:bg-black disabled:opacity-40"
              title="Send"
            >
              {busy ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function TimelineTurn({
  index,
  childPrompt,
  userExplanation,
}: {
  index: number;
  childPrompt: string;
  userExplanation: string;
}) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--accent-100)] bg-[var(--accent-50)] text-[11px] font-semibold tabular-nums text-[var(--accent-700)]">
          {index + 1}
        </div>
        <div className="mt-1 min-h-8 flex-1 border-l border-[var(--border-subtle)]" />
      </div>
      <div className="min-w-0 space-y-2 pb-2">
        <MiniPrompt text={childPrompt} />
        <div className="rounded-lg bg-[var(--ink-900)] px-3 py-2 text-[13px] leading-relaxed text-white">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/55">
            Explanation
          </p>
          <p className="whitespace-pre-wrap">{userExplanation}</p>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border border-[var(--accent-100)] bg-[var(--accent-50)] px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[var(--accent-700)]">
        <MessageCircleQuestionMark className="h-3.5 w-3.5" />
        <p className="text-[11px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink-900)]">
        {text}
      </p>
    </div>
  );
}

function MiniPrompt({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[var(--ink-500)]">
        <MessageCircleQuestionMark className="h-3.5 w-3.5" />
        <p className="text-[10.5px] font-semibold uppercase tracking-wider">Question</p>
      </div>
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ink-700)]">
        {text}
      </p>
    </div>
  );
}

function FeedbackCard({
  summary,
  parts,
}: {
  summary?: string;
  parts: string[];
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-emerald-700">
          <BookOpenCheck className="h-3.5 w-3.5" />
          <p className="text-[11px] font-semibold uppercase tracking-wider">Session feedback</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Complete
        </span>
      </div>
      {parts.length > 1 ? (
        <div className="space-y-2">
          {parts.map((part, i) => (
            <p key={i} className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-900)]">
              {part}
            </p>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-900)]">
          {summary || "No written feedback was returned for this session."}
        </p>
      )}
    </div>
  );
}

function LoadingPrompt({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center text-[var(--ink-500)]">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:300ms]" />
      </div>
      <p className="text-[12px]">{text}</p>
    </div>
  );
}

function splitFeedback(summary?: string): string[] {
  if (!summary) return [];
  return summary
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function EmptyHint({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <div className="mb-3 flex justify-center">{icon}</div>
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-500)]">{text}</p>
      </div>
    </div>
  );
}
