# Braynr Visualizer

> Read with a brain on your shoulder.

Drop in any text-tagged PDF. An agent reads it page by page, picks the
concepts that benefit from a visual aid, and renders them right next to
the text — interactive 3D models, animated 2D simulations, formulas with
step-by-step derivations, plotted graphs, or live source citations. The
left pane is the document; the right pane fills in by itself as the
agent figures things out.

The agent is the locally-installed [Codex CLI](https://github.com/openai/codex)
(`codex exec`) driven through the official `@openai/codex-sdk`. Every
response is constrained by a strict JSON Schema, so a "concept" or a
"visualization" is always a typed object the UI can render.

---

## The product

The user does one thing: drop a PDF. From there, everything happens
automatically.

1. **Detect.** Each page of text is sent to the agent with a prompt that
   says "give me up to 4 concepts on this page that would benefit from a
   picture, and the verbatim sentence-tail to anchor each one." Tags
   appear inline in the document the moment they come back, in the
   language of the source.

2. **Generate.** As soon as a tag exists, a second agent call produces
   the visualization spec for it — Three.js scene, Canvas animation,
   LaTeX formula, chart data, or markdown + citations. Up to four of
   these run in parallel. The first one ready is auto-selected so the
   right pane is never empty.

3. **Read.** Click any tag in the document; the right pane swaps to that
   concept's visualization. Drag/scroll on 3D scenes; animations play
   continuously; formulas render through KaTeX; sources are linked out.

4. **Recover.** If the model emits code that fails to compile, the
   visualizer captures the runtime error and hands it straight back to
   the agent for a repair attempt — up to a configurable budget. The
   user sees a "repairing — attempt N of M" sub-line, not a stack trace.

5. **Resume.** State is mirrored to `sessionStorage`. F5 / Fast-Refresh /
   bfcache restores all bring back tags, generated specs, the active
   selection, and any in-flight generations (which re-fire automatically).
   Closing the tab clears it.

---

## Five render modes

| `type`        | renderer                          | best for                                                     |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| `3d`          | Three.js scene with auto-orbit    | organs, molecules, anatomy, mechanical parts, architecture   |
| `2d-anim`     | Canvas2D, frame-by-frame draw     | inclined planes, pendulums, blood flow, chemical reactions   |
| `formula`     | KaTeX, headline + step derivation | equations and proofs walked through line by line             |
| `graph`       | Custom Canvas chart engine        | function plots, bell curves, range curves, scatter, bars     |
| `2d-text`     | Markdown + cited sources          | legal articles, court rulings, named papers, definitions     |

The `analyze-pdf` agent picks the right mode for each concept; the
`generate-viz` agent fills in the spec. For 3D and 2D-anim the spec
contains a JS function body that runs in a sandboxed `new Function`
wrapper; for the others, the spec is pure data.

---

## Run it

Pre-requisites:

- Node 20+
- An authenticated `codex` CLI (`codex login`) — uses your local
  ChatGPT or API account.

```bash
npm install
cp .env.example .env       # tweak knobs if you want
npm run generate-pdfs      # one-time: build 5 sample PDFs into public/pdfs/
npm run dev                # http://localhost:3000
```

Open the page, drop a PDF or click any sample. Watch tags appear and
the right pane fill in.

---

## Configuration

All knobs live in `.env` (gitignored) and `.env.example` (template,
committed). They're `NEXT_PUBLIC_*` so they reach the client bundle.

### `NEXT_PUBLIC_AUTO_GENERATE_VIZ` — default `true`

Production behavior: every detected tag fires its visualization
generation in parallel (capped at 4 concurrent). The user sees the right
pane fill in by itself.

Set to `false` for manual mode: tags appear after detection but no codex
token is spent until the user clicks a tag. A small "manual" chip shows
up in the viewer header. Use this while iterating on the UI.

### `NEXT_PUBLIC_MAX_VIZ_GEN_RETRIES` — default `3`

Maximum *additional* generation calls per tag if the visualizer crashes
the spec. Total attempts = `1 + this`. Lower this while you're testing
to keep token usage tight; raise it on rough PDFs.

---

## Architecture

```
┌──────────────┐   POST /api/upload     ┌──────────────────────────────┐
│  Browser     │ ─────────────────────► │  Server                       │
│              │                        │   • saves PDF to /tmp         │
│              │ ◄─ {docId, pages…} ─── │   • pdfjs-dist extracts text  │
│              │                        │     + per-glyph bboxes        │
└──────────────┘                        └──────────────────────────────┘
                                                  │
   page renders, then ─ per-page ─►   POST /api/analyze-pdf
                                       (codex, low effort, JSON schema)
                                                  │
                                       returns DetectedConcept[]
                                                  │
   per-tag (parallel, ≤4) ──────────►   POST /api/generate-viz
                                       (codex, low effort first, medium
                                        on repair; web_search only for
                                        the 2d-text type)
                                                  │
                                       returns VizSpec
```

### File layout

```
app/
  page.tsx                       Landing — UploadCard
  viewer/[docId]/page.tsx        Server entry — async params
  viewer/[docId]/viewer-client.tsx
                                 Orchestrator: detection queue, viz
                                 generation queue, persistence,
                                 retry-on-runtime-error logic
  api/
    upload/                      POST PDF → docId + page metadata
    pdf/[docId]/                 GET raw PDF bytes (for pdf.js)
    doc/[docId]/                 GET parsed metadata (used on reload)
    analyze-pdf/                 POST { docId, pageIndex } → tags
    generate-viz/                POST { type, label, context, … }
                                       → spec, with optional
                                         previousAttempt for repair
    sample-pdfs/                 GET available samples + sizes

components/
  PdfViewer.tsx                  pdf.js render + tag-pill overlay
                                 (idle / generating / ready states,
                                  click handler, auto-scroll)
  UploadCard.tsx                 dropzone + sample grid + landing copy
  Visualizer/
    index.tsx                    type → renderer routing, header chip,
                                 loading + empty + caption frame
    ThreeDView.tsx               sandboxed Three.js executor
                                 (auto-orbit, pointer drag/scroll,
                                  bbox-based framing)
    TwoDAnimView.tsx             sandboxed Canvas executor (rAF loop)
    FormulaView.tsx              KaTeX with throwOnError:false
    GraphView.tsx                Canvas chart engine (function / lines /
                                 points / bars)
    TwoDTextView.tsx             react-markdown + numbered citations

lib/
  codex.ts                       SDK wrapper — runJson<T>(prompt, schema)
                                 with one-shot retry on parse failure
  config.ts                      AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES
  schemas.ts                     Per-type strict JSON Schemas + TS types
  pdf-extract.ts                 pdfjs-dist text + bbox extraction;
                                 anchor locator (substring → coords)
  store.ts                       In-memory + /tmp doc store, HMR-safe
  persistence.ts                 sessionStorage hydration + flush
  viz-runtime.ts                 IIFE-scoped sandbox for LLM-emitted JS
                                 (forbidden globals shadowed)

scripts/
  generate-sample-pdfs.ts        Builds 5 multi-page sample PDFs via
                                 pdfkit into public/pdfs/
  smoke-test.mjs                 One PDF, one tag, one screenshot
  full-test.mjs                  All 5 PDFs, screenshots per type
  test-manual-mode.mjs           Verifies AUTO_GENERATE_VIZ=false
  test-persistence.mjs           Verifies F5 mid-generation flow
  test-auto-fix.mjs              Forces a viz crash via Playwright
                                 route() and verifies the repair loop
```

### Generation pipeline details

Detection (`/api/analyze-pdf`):

- One call per page, capped at 3 concurrent.
- Pages with <120 chars (title pages) return `{concepts: []}` without
  hitting codex.
- The prompt asks the model to write `label` and `context` in the
  source PDF's language.

Generation (`/api/generate-viz`):

- One call per tag, capped at 4 concurrent (client-side queue).
- Reasoning effort: `low` for first attempt, `medium` when handling a
  `previousAttempt` repair.
- Web search: enabled only for the `2d-text` type (citations need
  grounding).
- Server-side syntax pre-flight: for `3d` and `2d-anim`, the returned
  `setup_code` is parsed via `new Function(...)`. If it fails, the
  server makes one silent repair call before responding — the client
  never sees that round-trip and the visible attempt budget is
  preserved for genuinely hard cases.

Auto-repair on visualizer crash:

- `ThreeDView` / `TwoDAnimView` / `GraphView` each accept
  `onRuntimeError(message)` and fire it exactly once per spec instance
  (a `reportedRef` guards against duplicate calls during animation
  loops or React StrictMode double-invocation).
- The orchestrator catches the report, builds a repair-state TagState
  inline (so `lastRuntimeError` is immediately available — no waiting
  for React to commit the setState), and pushes to the same
  `pumpVizQueue` with `previousAttempt: { spec, runtimeError }`.
- The route prepends a "diagnose and fix" preamble showing the broken
  code + the runtime error.
- After `MAX_VIZ_GEN_RETRIES` retries, the tag is marked with a
  human-readable error and the visualizer falls through to a calm
  amber-toned banner.

Persistence:

- `useState` lazy initializers hydrate from sessionStorage on mount.
- A debounced effect (250 ms) saves on every state change.
- `pagehide` and `visibilitychange:hidden` listeners flush
  synchronously so the latest state always lands in storage before the
  document unloads.
- On mount, tags marked `generating: true` get re-enqueued so any
  in-flight repair continues from scratch.

---

## Sandbox model for LLM-emitted code

`3d` and `2d-anim` specs carry a JavaScript function body. We wrap it
like this in [`lib/viz-runtime.ts`](lib/viz-runtime.ts):

```js
function compiled(api, window, document, fetch, ...) {
  const THREE = api.THREE; const scene = api.scene; /* … */
  return (function () {
    "use strict";
    /* model code goes here */
  })();
}
```

- The outer function takes `api` as the only meaningful argument; the
  forbidden globals (`window`, `document`, `fetch`, `XMLHttpRequest`,
  `WebSocket`, `Function`, `globalThis`, `self`, `process`,
  `navigator`, `location`, `localStorage`, `sessionStorage`,
  `require`) are shadowed as undefined parameters.
- The model's code runs inside an IIFE so it can re-declare `THREE`,
  `ctx`, etc. without colliding with the outer scope's bindings.
- Try/catches around setup and per-frame execution surface errors via
  `onRuntimeError` for the auto-repair loop.

This is a demo sandbox, not a hard security boundary. The user runs
their own codex account against their own PDFs; the boundary is
"reasonable defense against LLM mistakes," not "defense against
adversarial input."

---

## Sample PDFs

`npm run generate-pdfs` runs [`scripts/generate-sample-pdfs.ts`](scripts/generate-sample-pdfs.ts),
a single-file pdfkit generator that produces 5 textbook chapters across
fields:

- **anatomy.pdf** — heart, pancreas, brain (great for 3D)
- **physics.pdf** — inclined planes, pendulums, projectiles (great for
  2d-anim and graphs)
- **costituzione.pdf** — selected articles of the Italian Constitution
  (great for 2d-text + web-grounded citations)
- **calculus.pdf** — derivatives, integrals, Taylor series (great for
  formula + graph)
- **chemistry.pdf** — methane, water, benzene (great for 3D molecular
  models)

Add a new entry to the `docs` array in that file and re-run the script
to ship more.

---

## Smoke testing

```bash
npm run smoke         # one PDF, one tag click, one screenshot
npm run smoke-all     # all 5 PDFs, multiple tag types per PDF
```

There are also focused tests under `scripts/` for specific behaviors:
manual mode, persistence resume, auto-fix loop. Each one is a single
file you can `node scripts/<name>.mjs` against a running dev server.

---

## Notes & limits

- The PDF must already have a text layer. We do not OCR images.
- Generation latency: detection ~10–20 s/page (low effort), code gen
  ~20–60 s for 3D / 2D-anim, ~10–15 s for formula / graph / text.
- The dev server caches Tailwind output; if you pull a commit that
  reworks `globals.css`, run `rm -rf .next && npm run dev` to force a
  rebuild.
- Server-side document state is process-local (held in
  [`lib/store.ts`](lib/store.ts)) and lives only in `/tmp`. A server
  restart drops it; the client surfaces a "please re-upload" message.
