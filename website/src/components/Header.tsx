"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Menu, X, Phone } from "lucide-react";
import { club, nav } from "@/content/site";

export function Header() {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  // Transparent over the hero, solid once you have scrolled past it, so the
  // nav never fights the hero image for contrast.
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A fixed-position menu over a scrolling page is disorienting on a phone.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        solid ? "bg-ink/95 backdrop-blur border-b border-ink-line" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 sm:h-20 flex items-center gap-4">
        <a href="#top" className="shrink-0" aria-label={club.name}>
          <Image
            src="/logo.png" alt={club.name}
            width={320} height={197} priority
            className="h-9 sm:h-11 w-auto"
          />
        </a>

        <nav className="hidden lg:flex items-center gap-7 ml-8">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm font-medium text-white/70 hover:text-white transition-colors"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={club.phoneHref}
            className="hidden sm:flex items-center gap-2 text-sm font-semibold text-white/80 hover:text-white transition-colors"
          >
            <Phone className="w-4 h-4" />
            {club.phone}
          </a>
          <a
            href="#enquire"
            className="hidden sm:inline-flex items-center px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-bold hover:bg-brand-dark transition-colors"
          >
            Book a day pass
          </a>
          <button
            onClick={() => setOpen(true)}
            className="lg:hidden p-2 -mr-2 text-white"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink lg:hidden">
          <div className="px-4 sm:px-6 h-16 sm:h-20 flex items-center">
            <Image src="/logo.png" alt={club.name} width={320} height={197} className="h-9 w-auto" />
            <button
              onClick={() => setOpen(false)}
              className="ml-auto p-2 -mr-2 text-white"
              aria-label="Close menu"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <nav className="px-4 sm:px-6 pt-6 flex flex-col">
            {nav.map((n, i) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="py-4 border-b border-ink-line flex items-baseline gap-4"
              >
                <span className="section-n text-xs text-brand">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="display text-3xl text-white">{n.label}</span>
              </a>
            ))}
            <a
              href="#enquire"
              onClick={() => setOpen(false)}
              className="mt-8 text-center px-5 py-4 rounded-lg bg-brand text-white font-bold"
            >
              Book a day pass — Rs 1,000
            </a>
            <a
              href={club.phoneHref}
              className="mt-3 text-center px-5 py-4 rounded-lg border border-ink-line text-white font-semibold"
            >
              Call {club.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
