import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation } from "wouter";

interface RouteTransitionProps {
  /** Pages with the same key stay mounted across navigation (e.g. /sign-in/*). */
  transitionKey: (location: string) => string;
  className?: string;
  /** Render the routes for this location; pass it to <Switch location>. */
  children: (location: string) => ReactNode;
}

/**
 * The shared page enter/exit fade. The routes are rendered for the location they were
 * opened with, so the page fading out keeps showing itself: otherwise it would briefly
 * render the NEXT page, which then mounts a second time and loses anything typed or
 * autofilled in the meantime.
 */
export function RouteTransition({ transitionKey, className, children }: Readonly<RouteTransitionProps>) {
  const [location] = useLocation();
  const shouldReduceMotion = useReducedMotion();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={transitionKey(location)}
        className={className}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {children(location)}
      </motion.div>
    </AnimatePresence>
  );
}
