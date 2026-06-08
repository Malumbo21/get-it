/**
 * GET  /api/welcome?key=welcome   → { key, dismissedVersion, currentVersion, shouldShow }
 * POST /api/welcome  { key }       → marks that popup as dismissed for the
 *                                    current app version. After this it won't
 *                                    reappear until the user updates Get It.
 *
 * Two independent launch popups are tracked by `key`:
 *   • "welcome"   — the founders' welcome card
 *   • "community" — the open-source / Discord contributor card
 * Each has its own "Don't show again", so dismissing one never hides the
 * other. `key` defaults to "welcome" for backward compatibility.
 *
 * Flags live at <DATA_DIR>/welcome.json as `{ dismissed: { <key>: <version> } }`.
 * The previous single-flag format (`{ dismissedVersion }`) is still read and
 * is treated as the "welcome" key, so existing installs keep their choice.
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";

const WELCOME_PATH = path.join(DATA_DIR, "welcome.json");

type WelcomeFile = {
  /** key → app version at which the popup was dismissed forever. */
  dismissed?: Record<string, string>;
  /** Legacy single flag — predates per-key tracking; maps to "welcome". */
  dismissedVersion?: string;
};

function readFile(): WelcomeFile {
  try {
    const raw = fs.readFileSync(WELCOME_PATH, "utf-8");
    const parsed = JSON.parse(raw) as WelcomeFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function dismissedVersionFor(key: string): string | null {
  const f = readFile();
  if (f.dismissed && typeof f.dismissed[key] === "string") {
    return f.dismissed[key];
  }
  // Legacy single flag applies to the welcome card only.
  if (key === "welcome" && typeof f.dismissedVersion === "string") {
    return f.dismissedVersion;
  }
  return null;
}

function writeDismissed(key: string, version: string): void {
  const f = readFile();
  const dismissed: Record<string, string> = { ...(f.dismissed ?? {}) };
  // Fold any legacy welcome flag into the keyed map so it isn't lost.
  if (f.dismissedVersion && dismissed.welcome == null) {
    dismissed.welcome = f.dismissedVersion;
  }
  dismissed[key] = version;
  const tmp = `${WELCOME_PATH}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ dismissed, savedAt: Date.now() }, null, 2),
  );
  fs.renameSync(tmp, WELCOME_PATH);
}

function normaliseKey(raw: string | null | undefined): string {
  return raw === "community" ? "community" : "welcome";
}

export async function GET(req: Request) {
  const key = normaliseKey(new URL(req.url).searchParams.get("key"));
  const dismissedVersion = dismissedVersionFor(key);
  return NextResponse.json({
    key,
    dismissedVersion,
    currentVersion: APP_VERSION,
    shouldShow: dismissedVersion !== APP_VERSION,
  });
}

export async function POST(req: Request) {
  let key = "welcome";
  try {
    const body = (await req.json()) as { key?: string };
    key = normaliseKey(body?.key);
  } catch {
    /* no body → default to the welcome card */
  }
  writeDismissed(key, APP_VERSION);
  return NextResponse.json({ ok: true, key, dismissedVersion: APP_VERSION });
}
