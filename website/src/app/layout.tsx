import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { club } from "@/content/site";
import "./globals.css";

// Self-hosted by next/font at build time — no runtime request to Google, which
// also means no layout shift and nothing to consent to.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

const description =
  "An independent gym in Paragon City, Lahore. Full strength floor, a separate " +
  "female section, nine certified trainers, and recovery on site — jacuzzi, ice " +
  "plunge, steam and sauna. Day pass Rs 1,000.";

export const metadata: Metadata = {
  title: {
    default: `${club.name} — Gym in Paragon City, Lahore`,
    template: `%s · ${club.name}`,
  },
  description,
  keywords: [
    "gym in Lahore", "gym in Paragon City", "ladies gym Lahore",
    "personal trainer Lahore", "CrossFit Lahore", "MMA Lahore",
    "Pilates Lahore", "Zumba Lahore", "ice plunge Lahore",
  ],
  openGraph: {
    title: `${club.name} — Paragon City, Lahore`,
    description,
    type: "website",
    locale: "en_PK",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // LocalBusiness/Gym structured data — this is what puts the address, phone
  // and opening hours into a Google result rather than leaving Google to
  // guess them off the page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ExerciseGym",
    name: club.name,
    description,
    address: {
      "@type": "PostalAddress",
      streetAddress: club.address.line1,
      addressLocality: "Lahore",
      addressRegion: "Punjab",
      addressCountry: "PK",
    },
    telephone: club.phone,
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "07:00",
        closes: "23:30",
      },
    ],
  };

  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
