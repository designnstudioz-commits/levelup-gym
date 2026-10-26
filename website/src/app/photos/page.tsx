import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Camera, Check } from "lucide-react";
import { club } from "@/content/site";
import { trainers } from "@/content/site";
import { photos, trainerPhotoBrief, photoStats } from "@/content/photos";

// A shot list, not a marketing page. It exists so the brief can be sent as a
// link instead of retyped into a message, and so it can never drift from the
// frames on the homepage — both read content/photos.ts.
export const metadata: Metadata = {
  title: "Photographs needed",
  robots: { index: false, follow: false },
};

const PRIORITY_STYLE: Record<string, string> = {
  Essential: "bg-brand text-white",
  Important: "bg-brand/20 text-brand border border-brand/40",
  "Nice to have": "bg-ink-soft text-white/60 border border-ink-line",
};

export default function PhotosPage() {
  const bySection = photos.reduce<Record<string, typeof photos>>((acc, p) => {
    (acc[p.section] ||= []).push(p);
    return acc;
  }, {});

  const essential = photos.filter((p) => p.priority === "Essential").length;

  return (
    <div className="bg-ink min-h-screen">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to the site
        </Link>

        <Image
          src="/logo.png" alt={club.name}
          width={320} height={197}
          className="h-14 w-auto mt-8"
        />

        <h1 className="display text-4xl sm:text-6xl text-white mt-6">
          Photographs we need
        </h1>
        <p className="mt-4 text-white/65 leading-relaxed max-w-2xl">
          {photoStats.outstanding} photographs, plus {trainers.length} trainer headshots.
          Everything else on the website is finished and waiting for these. Shoot them in
          one visit if you can — the whole set in the same light looks far better than
          good pictures taken on different days.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-px bg-ink-line border border-ink-line rounded-xl overflow-hidden">
          <div className="bg-ink px-4 py-5">
            <p className="display text-4xl text-brand">{photoStats.outstanding}</p>
            <p className="text-xs text-white/50 mt-1">still needed</p>
          </div>
          <div className="bg-ink px-4 py-5">
            <p className="display text-4xl text-white">{essential}</p>
            <p className="text-xs text-white/50 mt-1">essential</p>
          </div>
          <div className="bg-ink px-4 py-5">
            <p className="display text-4xl text-white">{trainers.length}</p>
            <p className="text-xs text-white/50 mt-1">headshots</p>
          </div>
        </div>

        {/* ── How to send them ── */}
        <div className="mt-10 rounded-2xl border border-ink-line bg-ink-soft p-6">
          <h2 className="display text-2xl text-white">Before you start</h2>
          <ul className="mt-4 space-y-2.5">
            {[
              "Name each file with the code beside it — HERO-01.jpg, REC-02.jpg. That is all we need to put it in the right place.",
              "Send the originals, not WhatsApp copies. WhatsApp shrinks photos to roughly a quarter of the size we need.",
              "Shoot in the evening when the lights are on and the club is busy. An empty gym looks closed.",
              "Landscape for wide shots, portrait where it says portrait — it is written on every frame.",
              "Ask anyone who appears in a photograph whether they mind being on a public website.",
            ].map((t) => (
              <li key={t} className="flex gap-3 text-sm text-white/65 leading-relaxed">
                <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* ── The list ── */}
        {Object.entries(bySection).map(([section, items]) => (
          <section key={section} className="mt-12">
            <h2 className="display text-3xl text-white">{section}</h2>
            <div className="mt-5 space-y-3">
              {items.map((p) => (
                <article
                  key={p.id}
                  className="rounded-xl border border-ink-line bg-ink-soft p-5 flex flex-col sm:flex-row sm:items-start gap-4"
                >
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand text-white text-[11px] font-bold tracking-wider self-start shrink-0">
                    <Camera className="w-3 h-3" />
                    {p.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-white">{p.title}</h3>
                    <p className="mt-1.5 text-sm text-white/60 leading-relaxed">{p.detail}</p>
                    <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand/80">
                      {p.orientation} · minimum {p.minWidth.toLocaleString()}px wide
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider self-start whitespace-nowrap ${PRIORITY_STYLE[p.priority]}`}
                  >
                    {p.priority}
                  </span>
                </article>
              ))}
            </div>
          </section>
        ))}

        {/* ── Headshots ── */}
        <section className="mt-12">
          <h2 className="display text-3xl text-white">Trainer headshots</h2>
          <p className="mt-3 text-sm text-white/60 leading-relaxed max-w-2xl">
            {trainerPhotoBrief.detail}{" "}
            <span className="text-brand/80 font-semibold">
              {trainerPhotoBrief.orientation}, minimum {trainerPhotoBrief.minWidth}px.
            </span>{" "}
            Name each file after the person.
          </p>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {trainers.map((t) => (
              <div
                key={t.name}
                className="rounded-lg border border-ink-line bg-ink-soft px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">{t.name}</p>
                <p className="text-xs text-white/45">{t.speciality}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-14 rounded-2xl border border-brand/30 bg-brand/5 p-6">
          <h2 className="display text-2xl text-white">Send them to</h2>
          <a href={club.phoneHref} className="mt-2 inline-block text-brand font-bold text-lg">
            {club.phone}
          </a>
          <p className="text-sm text-white/55 mt-1">
            Or any shared drive — a link is fine, as long as the files are the originals.
          </p>
        </div>
      </div>
    </div>
  );
}
