import { useEffect, useLayoutEffect } from "react";

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Public pages are prerendered at build time (entry-server.tsx) and served inside
 * #prerendered, with the React root (#root) hidden beside it. The real HTML is what crawlers
 * read and what visitors see while the app boots; the app takes over once it can render the
 * page itself, so visitors never see a loading screen in between.
 */
const PRERENDERED_ID = "prerendered";

export const bootedFromPrerender =
  typeof document !== "undefined" && document.getElementById(PRERENDERED_ID) !== null;

export function completePrerenderHandoff() {
  if (typeof document === "undefined") return;
  document.getElementById(PRERENDERED_ID)?.remove();
  document.getElementById("root")?.removeAttribute("hidden");
}

/** Rendered alongside a page: swaps the prerendered copy for the live page in the same frame. */
export function PrerenderHandoff() {
  useClientLayoutEffect(completePrerenderHandoff, []);
  return null;
}
