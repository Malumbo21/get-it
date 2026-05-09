/**
 * Build-time and runtime configuration.
 *
 * Public flags must be prefixed with NEXT_PUBLIC_ so Next.js inlines them
 * into the client bundle.
 */

/**
 * If true (default), the moment a page's tags come back from detection we
 * eagerly fire visualization generation for every tag in parallel — the
 * user sees the right pane fill in by itself. This is the production UX.
 *
 * If false, generation is deferred and only kicked off when the user
 * actually clicks a tag. Useful during dev so we don't burn tokens on
 * every page load.
 *
 * The check uses `!== "false"` so any other value (or unset) defaults to
 * the eager / production behavior.
 */
export const AUTO_GENERATE_VIZ =
  process.env.NEXT_PUBLIC_AUTO_GENERATE_VIZ !== "false";
