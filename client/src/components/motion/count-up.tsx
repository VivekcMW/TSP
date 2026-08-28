import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface CountUpProps {
  value: string; // e.g. "10K+", "500K+", "95%"
  className?: string;
}

// Animates the leading numeric portion of a display string from 0 up to its
// value once scrolled into view, preserving the original suffix (K+, %, ...).
export function CountUp({ value, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduceMotion = useReducedMotion();

  const match = value.match(/^([\d.]+)(.*)$/);
  const numeric = match ? Number.parseFloat(match[1]) : null;
  const suffix = match ? match[2] : "";

  const [display, setDisplay] = useState(shouldReduceMotion || numeric === null ? value : `0${suffix}`);

  useEffect(() => {
    if (shouldReduceMotion || numeric === null || !isInView) return;
    const duration = 1200;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const current = numeric * eased;
      setDisplay(`${Number.isInteger(numeric) ? Math.round(current) : current.toFixed(1)}${suffix}`);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isInView, shouldReduceMotion, numeric, suffix]);

  return (
    <span ref={ref} className={className}>
      {shouldReduceMotion || numeric === null ? value : display}
    </span>
  );
}
