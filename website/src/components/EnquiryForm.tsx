"use client";

import { useState } from "react";
import { Send, Check } from "lucide-react";
import { club, enquiry } from "@/content/site";

// Submits to WhatsApp rather than to a server.
//
// Deliberate for v1: there is no backend on this site, so there is nowhere to
// store a lead and nothing to secure. Pre-filling WhatsApp puts the enquiry in
// the one inbox reception already watches all day, works on every phone in
// Pakistan, and gives the member a copy of what they sent. No database, no
// email service, no spam endpoint, nothing to leak.
//
// When this should post into the gym's own submissions table instead, replace
// buildMessage/handleSubmit with a fetch to an API route — the fields already
// match the columns the registration flow uses.
export function EnquiryForm() {
  const [form, setForm] = useState({ name: "", phone: "", interest: enquiry.interests[0] });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildMessage() {
    return [
      `Hello ${club.shortName}, I would like to enquire.`,
      ``,
      `Name: ${form.name.trim()}`,
      `Phone: ${form.phone.trim()}`,
      `Interested in: ${form.interest}`,
    ].join("\n");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Please tell us your name."); return; }
    // Loose on purpose: 0300-1234567, +92 300 1234567 and 03001234567 are all
    // things real people type. Count the digits, do not police the format.
    if (form.phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a phone number we can reach you on.");
      return;
    }
    setError(null);
    window.open(`${club.whatsappHref}?text=${encodeURIComponent(buildMessage())}`, "_blank", "noopener");
    setSent(true);
  }

  const field =
    "w-full px-4 py-3 rounded-lg bg-ink-soft border border-ink-line text-white placeholder:text-white/35 " +
    "focus:outline-none focus:border-brand transition-colors";

  if (sent) {
    return (
      <div className="rounded-2xl border border-ink-line bg-ink-soft p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-brand/15 flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6 text-brand" />
        </div>
        <p className="display text-2xl text-white">WhatsApp is open</p>
        <p className="text-sm text-white/60 mt-2 max-w-sm mx-auto">
          Send the message we have written for you and reception will reply. If nothing
          opened, call us on{" "}
          <a href={club.phoneHref} className="text-brand font-semibold">{club.phone}</a>.
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-5 text-sm font-semibold text-white/60 hover:text-white transition-colors"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-ink-line bg-ink-soft p-6 sm:p-8 space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">
          Your name
        </label>
        <input
          id="name" type="text" autoComplete="name" className={field} placeholder="Ahmed Khan"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">
          Phone
        </label>
        <input
          id="phone" type="tel" inputMode="tel" autoComplete="tel" className={field} placeholder="0300 1234567"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="interest" className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">
          What are you after?
        </label>
        <select
          id="interest" className={field}
          value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })}
        >
          {enquiry.interests.map((i) => (
            <option key={i} value={i} className="bg-ink-soft">{i}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}

      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 px-5 py-4 rounded-lg bg-brand text-white font-bold hover:bg-brand-dark transition-colors"
      >
        <Send className="w-4 h-4" />
        Send on WhatsApp
      </button>

      <p className="text-xs text-white/40 text-center">
        Goes straight to reception. We do not pass your number to anyone else.
      </p>
    </form>
  );
}
