/**
 * Pure types + helpers for the knowledge graph.
 *
 * Lives in its own module so client components can import these types and
 * pure helpers without dragging in the server-only fs/path code that
 * lib/kg.ts uses for persistence.
 */

export type KGEvaluation = {
  /** 0–100. How well the user RECALLS the concept (memory). */
  memory: number;
  /** 0–100. How deeply the user UNDERSTANDS it (own words / metaphors). */
  comprehension: number;
  /** 0–100. How well the user grasps STRUCTURE (relations / chains). */
  structure: number;
  /** 0–100. How well the user APPLIES the concept to new cases. */
  application: number;
};

export type KGNode = {
  id: string;
  label: string;
  summary: string;
  pageHints: number[];
  evaluation: KGEvaluation;
  evaluatorNote: string;
};

export type KGEdge = {
  source: string;
  target: string;
  relation: string;
};

export type KnowledgeGraphStatus = "missing" | "building" | "ready" | "error";

export type KnowledgeGraph = {
  v: 1;
  docId: string;
  status: KnowledgeGraphStatus;
  buildAt: number | null;
  lastEvaluatedAt: number | null;
  evaluationCount: number;
  nodes: KGNode[];
  edges: KGEdge[];
  globalNote: string;
  buildError?: string;
  /** Response-only flag set by GET /api/kg/[docId]/state when an evaluator
   *  pass is in flight. Not persisted to disk. */
  evaluating?: boolean;
};

/** Map an evaluation to a single 0–100 mastery score for UI display. */
export function masteryScore(e: KGEvaluation): number {
  return Math.round(
    e.memory * 0.25 +
      e.comprehension * 0.30 +
      e.structure * 0.20 +
      e.application * 0.25,
  );
}
