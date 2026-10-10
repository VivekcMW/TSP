import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useIsSignedIn } from "@/lib/dev-auth";

/**
 * Phones only: a pinned "Start free" once the hero's buttons scroll out of view.
 * It gives way to the cookie banner (body[data-cookie-banner=open]) instead of stacking on it.
 * Portalled into <body>: the page-transition wrapper animates a transform, and a transformed
 * ancestor would pin this "fixed" bar to the page instead of the screen.
 */
export function StickyMobileCta() {
  const isSignedIn = useIsSignedIn();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const target = document.getElementById("hero-cta");
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (isSignedIn) return null;
  return createPortal(
    <div
      data-testid="sticky-mobile-cta"
      className={`fixed inset-x-0 bottom-0 z-40 border-t bg-card px-4 pt-3 md:hidden [body[data-cookie-banner=open]_&]:hidden ${show ? "" : "hidden"}`}
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <Link href="/sign-up" className="flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-hover active:bg-primary-active ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        Start free
      </Link>
    </div>,
    document.body,
  );
}
