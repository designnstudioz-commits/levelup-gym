"use client";

import { useEffect } from "react";

// Scrolling the page with the cursor over a focused number input silently
// changes its value in most browsers — a real problem for price fields,
// where staff scrolling past one can drift the value without noticing.
// Blurring the input on the very first wheel tick stops the browser's
// native increment/decrement before it can compound, without needing to
// touch every individual <input type="number"> across the app (or any
// added later).
export function NumberInputWheelGuard() {
  useEffect(() => {
    function handleWheel(e: WheelEvent) {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) {
        target.blur();
      }
    }
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);

  return null;
}
