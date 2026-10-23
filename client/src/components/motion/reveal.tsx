import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

interface RevealProps {
  children: ReactNode;
  variants?: Variants;
  className?: string;
  delay?: number;
}

// Fades/slides an element in once it scrolls into view. Falls back to a plain
// div when the user has asked for reduced motion.
export function Reveal({ children, variants = fadeUp, className, delay = 0 }: RevealProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={variants}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Forwarded so an animated wrapper can still carry the element's test hook. */
  "data-testid"?: string;
}

// Wraps a group of `StaggerItem` children so they cascade in one after another.
export function StaggerGroup({ children, className, "data-testid": testId }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className} data-testid={testId}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      data-testid={testId}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={staggerContainer}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, "data-testid": testId }: StaggerProps) {
  return (
    <motion.div className={className} data-testid={testId} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
