import {
  ArrowRight, MapPin, Phone, Clock, Check, Snowflake, Waves, Flame, Stethoscope, Camera,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/Header";
import { PhotoSlot, TrainerPhoto } from "@/components/PhotoSlot";
import { photoStats, trainerPhotoBrief } from "@/content/photos";
import { EnquiryForm } from "@/components/EnquiryForm";
import {
  club, hero, pillars, planGroups, personalTraining, trainers,
  recovery, facilities, whoWeAre, enquiry, ADMISSION_FEE,
} from "@/content/site";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/** The numbered label every section is hung off, so the page reads as a
 *  sequence rather than a pile of blocks. */
function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="section-n text-xs text-brand">{n}</span>
      <span className="h-px flex-1 max-w-16 bg-brand/40" />
      <span className="text-xs font-bold uppercase tracking-widest text-white/50">{children}</span>
    </div>
  );
}

const RECOVERY_ICONS = [Waves, Snowflake, Flame, Stethoscope];

export default function Home() {
  return (
    <div id="top" className="bg-ink">
      <Header />

      {/* Draft notice. Remove this block, and the PhotoSlot frames go with
          it, once every photograph has been supplied. */}
      {photoStats.outstanding > 0 && (
        <div className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-4 sm:w-80 z-40 rounded-xl border border-brand/40 bg-brand/95 backdrop-blur p-4 shadow-2xl">
          <p className="text-sm font-bold text-white">
            Draft — {photoStats.outstanding} photographs still needed
          </p>
          <p className="text-xs text-white/85 mt-1 leading-relaxed">
            The dashed orange frames show where each one goes and what it should contain.
          </p>
          <Link
            href="/photos"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white underline underline-offset-2"
          >
            See the full shot list
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative pt-28 sm:pt-36 pb-16 sm:pb-24 overflow-hidden">
        {/* Flat brand wash rather than a gradient-heavy hero — the brand is
            explicitly flat, so depth comes from type scale, not glow. */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-32 w-[34rem] h-[34rem] rounded-full bg-brand/15 blur-3xl" />
          <div className="absolute top-1/3 -left-40 w-[26rem] h-[26rem] rounded-full bg-brand/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <p className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-ink-line bg-ink-soft text-xs font-semibold text-white/70">
            <MapPin className="w-3.5 h-3.5 text-brand" />
            {hero.eyebrow}
          </p>

          <h1 className="display mt-6 text-[3.25rem] leading-[0.9] sm:text-8xl lg:text-9xl text-white max-w-5xl">
            {hero.headline[0]}
            <br />
            <span className="text-brand">{hero.headline[1]}</span>
          </h1>

          <p className="mt-7 text-base sm:text-lg text-white/65 max-w-2xl leading-relaxed">
            {hero.sub}
          </p>

          <div className="mt-9 flex flex-col sm:flex-row gap-3 sm:items-center">
            <a
              href={hero.primaryCta.href}
              className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg bg-brand text-white font-bold hover:bg-brand-dark transition-colors"
            >
              {hero.primaryCta.label}
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href={hero.secondaryCta.href}
              className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg border border-ink-line text-white font-semibold hover:border-white/40 transition-colors"
            >
              {hero.secondaryCta.label}
            </a>
          </div>

          <dl className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-px bg-ink-line border border-ink-line rounded-2xl overflow-hidden">
            {hero.stats.map((s) => (
              <div key={s.label} className="bg-ink px-5 py-6">
                <dt className="display text-4xl sm:text-5xl text-brand">{s.value}</dt>
                <dd className="mt-1 text-xs sm:text-sm text-white/55">{s.label}</dd>
              </div>
            ))}
          </dl>

          <PhotoSlot id="HERO-01" className="mt-12" />

          <ul className="mt-8 flex flex-wrap gap-2">
            {hero.tags.map((t) => (
              <li key={t} className="px-3 py-1.5 rounded-full border border-ink-line text-xs font-medium text-white/60">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 01 What we do ──────────────────────────────────────── */}
      <section id="what-we-do" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="01">What we do</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            Four reasons people stay
          </h2>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {pillars.map((p, i) => (
              <article
                key={p.n}
                className="group rounded-2xl border border-ink-line bg-ink-soft p-6 flex flex-col hover:border-brand/50 transition-colors"
              >
                <PhotoSlot id={`DO-0${i + 1}`} className="mb-5 -mx-6 -mt-6 rounded-b-none border-x-0 border-t-0" compact />
                <span className="section-n text-xs text-brand">{p.n}</span>
                <h3 className="display text-2xl text-white mt-4">{p.title}</h3>
                <p className="mt-3 text-sm text-white/60 leading-relaxed flex-1">{p.body}</p>
                <a
                  href={p.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-brand group-hover:gap-2.5 transition-all"
                >
                  {p.linkLabel}
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 02 Who we are ──────────────────────────────────────── */}
      <section id="about" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 grid lg:grid-cols-2 gap-14">
          <div>
            <SectionLabel n="02">Who we are</SectionLabel>
            <h2 className="display text-4xl sm:text-6xl text-white">{whoWeAre.heading}</h2>
            <div className="mt-7 space-y-4">
              {whoWeAre.body.map((p, i) => (
                <p key={i} className="text-base text-white/65 leading-relaxed">{p}</p>
              ))}
            </div>
          </div>

          <div className="lg:pt-16 space-y-4">
            <PhotoSlot id="ABOUT-01" />
            {whoWeAre.points.map((pt) => (
              <div key={pt.title} className="flex gap-4 rounded-xl border border-ink-line bg-ink-soft p-5">
                <Check className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-white">{pt.title}</h3>
                  <p className="text-sm text-white/55 mt-1">{pt.body}</p>
                </div>
              </div>
            ))}

            <div className="rounded-xl border border-brand/30 bg-brand/5 p-5">
              <h3 className="display text-2xl text-white">Everything on one floor</h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {facilities.map((f) => (
                  <li key={f} className="px-2.5 py-1 rounded-md bg-ink text-xs font-medium text-white/65">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 Memberships ─────────────────────────────────────── */}
      <section id="memberships" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="03">Memberships</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            Pick what you will actually use
          </h2>
          <p className="mt-5 text-white/60 max-w-2xl">
            Every price below is the real monthly fee. A one-time admission fee of{" "}
            <span className="text-white font-semibold">{rs(ADMISSION_FEE)}</span> applies to
            memberships — never to a day pass or a single session.
          </p>

          {planGroups.map((group) => (
            <div key={group.id} className="mt-14">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-6">
                <h3 className="display text-3xl text-white">{group.label}</h3>
                <p className="text-sm text-white/45">{group.note}</p>
              </div>

              <div
                className={`grid gap-4 ${
                  group.id === "single"
                    ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
                    : "sm:grid-cols-2 lg:grid-cols-3"
                }`}
              >
                {group.plans.map((plan) => (
                  <article
                    key={plan.name}
                    className={`rounded-2xl border p-6 flex flex-col ${
                      plan.featured
                        ? "border-brand bg-brand/10"
                        : "border-ink-line bg-ink-soft"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="display text-2xl text-white">{plan.name}</h4>
                      {plan.femaleOnly && (
                        <span className="px-2 py-0.5 rounded-full bg-brand/20 text-brand text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                          Women only
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-white/55">{plan.blurb}</p>

                    <p className="mt-5 flex items-baseline gap-1.5">
                      <span className="display text-4xl text-brand">{rs(plan.monthly ?? 0)}</span>
                      <span className="text-xs text-white/45">
                        {group.id === "single" && plan.name !== "Day Pass" && !plan.name.includes("Table Tennis") && plan.name !== "Nutritionist" && plan.name !== "Kids Play Area"
                          ? "/ session"
                          : group.id === "single" && plan.name === "Day Pass"
                            ? "/ day"
                            : "/ month"}
                      </span>
                    </p>

                    {plan.includes && (
                      <ul className="mt-5 space-y-2 flex-1">
                        {plan.includes.map((inc) => (
                          <li key={inc} className="flex gap-2 text-sm text-white/60">
                            <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                            {inc}
                          </li>
                        ))}
                      </ul>
                    )}

                    <a
                      href="#enquire"
                      className={`mt-6 text-center px-4 py-3 rounded-lg font-bold text-sm transition-colors ${
                        plan.featured
                          ? "bg-brand text-white hover:bg-brand-dark"
                          : "border border-ink-line text-white hover:border-brand hover:text-brand"
                      }`}
                    >
                      Enquire
                    </a>
                  </article>
                ))}
              </div>
            </div>
          ))}

          {/* Personal training — intentionally priceless on the page */}
          <div className="mt-14 rounded-2xl border border-ink-line bg-ink-soft p-8 sm:p-10 grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="display text-3xl sm:text-4xl text-white">Personal training</h3>
              <p className="mt-4 text-white/65 leading-relaxed">{personalTraining.blurb}</p>
              <p className="mt-3 text-sm text-white/40">{personalTraining.note}</p>
            </div>
            <div>
              <div className="grid grid-cols-2 gap-3">
                {personalTraining.tiers.map((t) => (
                  <div key={t} className="rounded-xl border border-ink-line bg-ink px-4 py-5 text-center">
                    <span className="display text-2xl text-white">{t}</span>
                  </div>
                ))}
              </div>
              <a
                href={personalTraining.cta.href}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-lg bg-brand text-white font-bold hover:bg-brand-dark transition-colors"
              >
                {personalTraining.cta.label}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 Recovery ────────────────────────────────────────── */}
      <section id="recovery" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="04">Recovery</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            The part most gyms here skip
          </h2>
          <p className="mt-5 text-white/60 max-w-2xl">
            Bundled into the Wellness, Recovery and Infinity memberships, or paid for one
            session at a time with no membership at all.
          </p>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {recovery.map((r, i) => {
              const Icon = RECOVERY_ICONS[i % RECOVERY_ICONS.length];
              return (
                <div key={r.name} className="rounded-2xl border border-ink-line bg-ink-soft p-6">
                  <PhotoSlot id={`REC-0${i + 1}`} className="mb-5" compact />
                  <div className="w-11 h-11 rounded-xl bg-brand/15 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-brand" />
                  </div>
                  <h3 className="display text-2xl text-white mt-5">{r.name}</h3>
                  <p className="mt-2 text-brand font-bold">{r.price}</p>
                  <p className="text-xs text-white/45">{r.unit}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 05 Trainers ────────────────────────────────────────── */}
      <section id="trainers" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="05">The team</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            Nine certified trainers
          </h2>

          <div className="mt-6 inline-flex items-start gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand/[0.04] p-4 max-w-2xl">
            <Camera className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <p className="text-sm text-white/65 leading-relaxed">
              <span className="font-bold text-white">9 headshots needed</span> — one per
              trainer. {trainerPhotoBrief.detail}{" "}
              <span className="text-brand/80 font-semibold">
                {trainerPhotoBrief.orientation}, min {trainerPhotoBrief.minWidth}px.
              </span>
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trainers.map((t) => (
              <article key={t.name} className="rounded-2xl border border-ink-line bg-ink-soft p-6 flex items-center gap-4">
                {/* Initials until real headshots exist — a stock silhouette
                    would look worse than an honest monogram. */}
                <TrainerPhoto name={t.name} />
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">{t.name}</h3>
                  <p className="text-sm text-brand">{t.speciality}</p>
                  {t.note && <p className="text-xs text-white/45 mt-0.5">{t.note}</p>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 The floor ───────────────────────────────────────── */}
      <section id="the-floor" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="06">The floor</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            What you are actually paying for
          </h2>
          <p className="mt-5 text-white/60 max-w-2xl">
            Equipment, not stock photography. Every frame below is a real corner of the club.
          </p>

          <div className="mt-12 grid grid-cols-2 lg:grid-cols-3 gap-4">
            {["FLOOR-01", "FLOOR-02", "FLOOR-03", "FLOOR-04", "FLOOR-05", "FLOOR-06"].map((id) => (
              <PhotoSlot key={id} id={id} compact />
            ))}
          </div>
        </div>
      </section>

      {/* ── 07 Enquire ─────────────────────────────────────────── */}
      <section id="enquire" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <SectionLabel n="07">Start here</SectionLabel>
            <h2 className="display text-4xl sm:text-6xl text-white">{enquiry.heading}</h2>
            <p className="mt-5 text-white/65 leading-relaxed max-w-lg">{enquiry.body}</p>

            <div className="mt-8 rounded-2xl border border-brand/30 bg-brand/5 p-6">
              <p className="display text-5xl text-brand">{rs(1000)}</p>
              <p className="text-sm text-white/60 mt-1">
                One day. Full floor, classes running that day, and the recovery room.
              </p>
            </div>

            <a
              href={club.phoneHref}
              className="mt-5 inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors"
            >
              <Phone className="w-4 h-4 text-brand" />
              <span className="font-semibold">{club.phone}</span>
              <span className="text-sm text-white/40">— or just call</span>
            </a>
          </div>

          <EnquiryForm />
        </div>
      </section>

      {/* ── 08 Visit ───────────────────────────────────────────── */}
      <section id="visit" className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionLabel n="08">Come and see it</SectionLabel>
          <h2 className="display text-4xl sm:text-6xl text-white max-w-3xl">
            Third floor, High Street Mall
          </h2>

          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <PhotoSlot id="VISIT-01" />
            <PhotoSlot id="VISIT-02" />
          </div>

          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-ink-line bg-ink-soft p-6">
              <MapPin className="w-5 h-5 text-brand" />
              <h3 className="display text-2xl text-white mt-4">Address</h3>
              <p className="mt-2 text-white/60 text-sm leading-relaxed">
                {club.address.line1}<br />
                {club.address.line2}<br />
                {club.address.country}
              </p>
            </div>

            <div className="rounded-2xl border border-ink-line bg-ink-soft p-6">
              <Clock className="w-5 h-5 text-brand" />
              <h3 className="display text-2xl text-white mt-4">Hours</h3>
              <dl className="mt-2 text-sm space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-white/45">Mon – Fri</dt>
                  <dd className="text-white/80">{club.hours.weekdays}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-white/45">Saturday</dt>
                  <dd className="text-white/80">{club.hours.saturday}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-white/45">Sunday</dt>
                  <dd className="text-white/80">{club.hours.sunday}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-white/40">{club.hours.note}</p>
            </div>

            <div className="rounded-2xl border border-ink-line bg-ink-soft p-6">
              <Phone className="w-5 h-5 text-brand" />
              <h3 className="display text-2xl text-white mt-4">Talk to us</h3>
              <a href={club.phoneHref} className="mt-2 block text-white/80 font-semibold hover:text-brand transition-colors">
                {club.phone}
              </a>
              <a
                href={club.whatsappHref}
                target="_blank" rel="noopener"
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand"
              >
                Message on WhatsApp
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Closing ────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 border-t border-ink-line">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <Image
            src="/logo.png" alt={club.name}
            width={320} height={197}
            className="h-16 sm:h-20 w-auto mx-auto mb-8"
          />
          <h2 className="display text-5xl sm:text-7xl text-white">
            One day costs {rs(1000)}.
            <br />
            <span className="text-brand">Decide after that.</span>
          </h2>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#enquire" className="px-7 py-4 rounded-lg bg-brand text-white font-bold hover:bg-brand-dark transition-colors">
              Book a day pass
            </a>
            <a href={club.phoneHref} className="px-7 py-4 rounded-lg border border-ink-line text-white font-semibold hover:border-white/40 transition-colors">
              Call {club.phone}
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-ink-line py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row gap-6 sm:items-center">
          <div>
            <Image src="/logo.png" alt={club.name} width={320} height={197} className="h-11 w-auto" />
            <p className="text-sm text-white/45 mt-3">
              {club.address.line1}, {club.address.line2}
            </p>
          </div>
          <p className="sm:ml-auto text-xs text-white/35">
            © {new Date().getFullYear()} {club.name}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
