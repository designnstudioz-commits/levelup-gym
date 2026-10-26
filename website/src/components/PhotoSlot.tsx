import Image from "next/image";
import { Camera } from "lucide-react";
import { photoById } from "@/content/photos";

/**
 * A labelled frame standing in for a photograph that has not been supplied.
 *
 * Shown deliberately rather than hidden: the client needs to open the site and
 * see exactly where photographs go and what each one should contain. The frame
 * states the reference code, the brief, the orientation and the minimum width,
 * so a shot can be taken and named without anyone writing a separate email.
 *
 * Give the entry in content/photos.ts a `src` and this renders the real image
 * instead — no change needed here or at the call site.
 */
export function PhotoSlot({
  id,
  className = "",
  compact = false,
}: {
  id: string;
  className?: string;
  compact?: boolean;
}) {
  const photo = photoById[id];
  if (!photo) return null;

  if (photo.src) {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl bg-ink-soft ${className}`}
        style={{ aspectRatio: photo.ratio }}
      >
        <Image
          src={photo.src}
          alt={photo.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-2xl border-2 border-dashed border-brand/40 bg-brand/[0.04] overflow-hidden ${className}`}
      style={{ aspectRatio: photo.ratio }}
    >
      {/* Faint diagonal hatch so the frame reads as "nothing here yet" at a
          glance, even in a screenshot sent over WhatsApp. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #F06418 0 1px, transparent 1px 11px)",
        }}
      />

      <div className="relative h-full w-full flex flex-col items-center justify-center text-center p-4 sm:p-6">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand text-white text-[10px] font-bold tracking-wider">
          <Camera className="w-3 h-3" />
          {photo.id}
        </span>

        <p className={`display text-white mt-3 ${compact ? "text-lg" : "text-xl sm:text-2xl"}`}>
          {photo.title}
        </p>

        {!compact && (
          <p className="mt-2 text-xs sm:text-sm text-white/55 max-w-sm leading-relaxed">
            {photo.detail}
          </p>
        )}

        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-brand/80">
          {photo.orientation} · min {photo.minWidth.toLocaleString()}px wide
        </p>
      </div>
    </div>
  );
}

/** The same idea for a trainer headshot: initials now, photograph later. */
export function TrainerPhoto({ name, src }: { name: string; src?: string }) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("");

  if (src) {
    return (
      <div className="relative w-14 h-14 rounded-full overflow-hidden shrink-0">
        <Image src={src} alt={name} fill className="object-cover" sizes="56px" />
      </div>
    );
  }

  return (
    <div
      className="w-14 h-14 rounded-full border-2 border-dashed border-brand/50 bg-brand/10 flex items-center justify-center shrink-0"
      title={`Headshot needed — ${name}`}
    >
      <span className="display text-lg text-brand">{initials}</span>
    </div>
  );
}
