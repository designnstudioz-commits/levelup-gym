"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

// Scroll reveals for the marketing page.
//
// `once: false` is the whole point here: a section animates in as it enters
// and back out as it leaves, in both directions, so scrolling up replays it
// rather than showing everything already settled. The usual marketing default
// is `once: true`; this is deliberately not that.
//
// `margin` pulls the trigger box well inside the viewport so a section only
// lets go once it is genuinely gone. Without it, content fades while still
// half on screen, which reads as a rendering fault rather than a transition.
const VIEWPORT = { once: false, amount: 0.15, margin: "-12% 0px -12% 0px" } as const;

// A long ease-out: fast to arrive, slow to settle. Tween rather than spring —
// springs overshoot, and an overshoot on a blur looks like a focus hunt.
const EASE = [0.16, 1, 0.3, 1] as const;

export function Reveal({
  children,
  className,
  delay = 0,
  blur = 12,
  y = 28,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  blur?: number;
  y?: number;
}) {
  const reduced = useReducedMotion();

  // Not a lighter animation — none. Someone who asked the operating system to
  // stop moving things should not get a blur pulse on every section either.
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: `blur(${blur}px)` }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={VIEWPORT}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const groupVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

// Cards carry a softer blur than a whole section. A dozen elements each
// animating a 12px filter at once is real work for the compositor, and the
// effect reads as heavy rather than crisp.
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE } },
};

/** Wraps a grid or list so its children arrive one after another. */
export function RevealGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={groupVariants}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
    >
      {children}
    </motion.div>
  );
}

/** One child of a RevealGroup. Inherits timing from the parent. */
export function RevealItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
