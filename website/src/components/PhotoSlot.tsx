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

/**
 * A trainer card: portrait photograph, name and speciality beneath it.
 *
 * Was a 56px circle with initials. The supplied photographs are full-length
 * studio portraits shot against the club's own walls — rendering those as
 * thumbnails would throw away the only real images the site has.
 *
 * Trainers still without a photograph keep a labelled frame at the same size,
 * so the grid stays even and the gap stays visible.
 */
export function TrainerCard({
  name,
  speciality,
  note,
  photo,
}: {
  name: string;
  speciality: string;
  note?: string;
  photo?: string;
}) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("");

  return (
    <article className="group rounded-2xl overflow-hidden border border-ink-line bg-ink-soft">
      <div className="relative aspect-3/4 overflow-hidden bg-ink">
        {photo ? (
          <>
            <Image
              src={photo}
              alt={name}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
            {/* Keeps the name legible over a busy gym background. */}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink to-transparent" />
          </>
        ) : (
          <div className="absolute inset-0 border-2 border-dashed border-brand/40 bg-brand/[0.04] flex flex-col items-center justify-center text-center p-4">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-brand/50 bg-brand/10 flex items-center justify-center">
              <span className="display text-2xl text-brand">{initials}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand text-white text-[10px] font-bold tracking-wider mt-4">
              <Camera className="w-3 h-3" />
              PHOTO NEEDED
            </span>
            <p className="mt-2 text-[10px] text-white/45 leading-snug">
              Head and shoulders<br />min 800px
            </p>
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="font-bold text-white truncate">{name}</h3>
        <p className="text-sm text-brand">{speciality}</p>
        {note && <p className="text-xs text-white/45 mt-0.5">{note}</p>}
      </div>
    </article>
  );
}
