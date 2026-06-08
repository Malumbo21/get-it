/**
 * Focused regression test for Codex error classification + the rate-limit
 * cooldown that closed the infinite-retry loop.
 *
 * Run: npx tsx scripts/test-error-handling.ts
 *
 * The old bug: a rate-limit error whose message had no "try again in X"
 * deadline left `retryAt` undefined. Background queues gated their backoff on
 * `e.retryAt`, so an undefined deadline meant NO backoff → the queue hammered
 * the API in a tight loop and the health banner re-fired forever. The fix
 * gives every rate-limit a concrete `retryAt` (a fallback cooldown when the
 * message carries none), so the gate is always taken.
 */

import {
  classifyCodexError,
  toCodexErrorPayload,
  type CodexErrorKind,
} from "../lib/codex-errors";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const now = Date.now();

// 1) Rate-limit WITHOUT a parseable deadline → must still get a future retryAt
//    (this is the exact case that used to bypass the backoff and loop).
const rlNoDeadline = classifyCodexError(
  "You've hit your usage limit on this account.",
);
check("rate-limit (no deadline) → kind=rate_limit", rlNoDeadline.kind === "rate_limit", rlNoDeadline.kind);
check(
  "rate-limit (no deadline) → retryAt is a future timestamp (fallback cooldown)",
  typeof rlNoDeadline.retryAt === "number" && rlNoDeadline.retryAt > now,
  `${rlNoDeadline.retryAt ? rlNoDeadline.retryAt - now : "undefined"}ms`,
);

// 2) Rate-limit WITH a deadline → honest, parsed retryAt (~2h), not the fallback.
const rl2h = classifyCodexError("Rate limit reached. Try again in 2 hours.");
check("rate-limit (2h) → kind=rate_limit", rl2h.kind === "rate_limit");
check(
  "rate-limit (2h) → retryAt ≈ 2h out (parsed, not the 60s fallback)",
  typeof rl2h.retryAt === "number" && rl2h.retryAt - now > 90 * 60_000,
  `${rl2h.retryAt ? Math.round((rl2h.retryAt - now) / 60000) : "?"}min`,
);

// 3) The retired-model 400 from the original screenshot → model_unsupported.
const modelErr = classifyCodexError(
  "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
);
check("retired-model 400 → kind=model_unsupported", modelErr.kind === "model_unsupported", modelErr.kind);

// 4) Auth / binary still classify correctly (must not be swallowed by rate-limit).
check("auth message → kind=auth_lost", classifyCodexError("You are not logged in").kind === "auth_lost");
check("binary message → kind=binary_missing", classifyCodexError("unable to locate codex").kind === "binary_missing");

// 5) A benign content/parse failure stays generic (no false rate-limit / model).
check("benign parse error → kind=generic", classifyCodexError("Empty finalResponse from codex").kind === "generic");

// 6) toCodexErrorPayload gives a non-empty friendly message for every kind, and
//    the model-unsupported one nudges to update the app.
const samples: Record<CodexErrorKind, string> = {
  rate_limit: "usage limit",
  auth_lost: "not logged in",
  binary_missing: "unable to locate codex",
  model_unsupported: "model is not supported",
  generic: "something odd happened",
};
for (const k of Object.keys(samples) as CodexErrorKind[]) {
  const p = toCodexErrorPayload(classifyCodexError(samples[k]));
  check(`payload[${k}] friendly message + correct kind`, p.kind === k && p.message.length > 10, `${p.kind}: ${p.message.slice(0, 56)}`);
}
check(
  "payload[model_unsupported] tells the user to update Get It",
  /latest|download|update/i.test(toCodexErrorPayload(classifyCodexError("model is not supported")).message),
);

console.log("");
if (failures > 0) {
  console.error(`✗ ${failures} check(s) failed`);
  process.exit(1);
}
console.log("✓ all checks passed");
