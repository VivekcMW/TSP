import type { Variants } from "framer-motion";
import { invariant } from "@/design/tokens";

// Shared easing curve so every animated element in the app feels consistent.
export const EASE = [0.16, 1, 0.3, 1] as const;
const duration = Number.parseFloat(invariant["motion-normal"]) / 1000;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration, ease: EASE } },
};

export const slideFromLeft: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration, ease: EASE } },
};

export const slideFromRight: Variants = {
  hidden: { opacity: 0, x: 8 },
  visible: { opacity: 1, x: 0, transition: { duration, ease: EASE } },
};

// Wrap on a parent element; children using `staggerItem` cascade in one after another.
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.025, delayChildren: 0 },
  },
};

export const staggerItem: Variants = fadeUp;
