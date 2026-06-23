/**
 * True when SC Feed is running as an embedded preview — either explicitly
 * flagged with `?embed=1` or rendered inside an iframe. Used to suppress
 * auto-popping UI (patch-notes modal, cookie banner) so embeds stay clean.
 *
 * Client-only: reads `window`, so call it inside an effect/handler — never
 * during render or on the server.
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flagged =
      new URLSearchParams(window.location.search).get("embed") === "1";
    const framed = window.self !== window.top;
    return flagged || framed;
  } catch {
    // Accessing window.top across origins can throw — which itself means
    // we're framed by a different origin.
    return true;
  }
}
