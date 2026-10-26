// Every piece of copy, price and name on the site lives here.
//
// This is deliberately a plain file rather than a database read. The site is
// public and static: it must stay up if Supabase is down, it must be
// impossible for it to leak member data, and a price change is a one-line
// edit someone can make without touching a component.
//
// Figures were taken from the live management system on 2026-10-26 and
// cross-checked against docs/website-content-data.md. When prices change in
// the gym, change them here — nothing reads them automatically.

export const club = {
  name: "Level Up Fitness Club",
  shortName: "Level Up",
  tagline: "Train like it matters",
  address: {
    line1: "3rd Floor, High Street Mall",
    line2: "Paragon City, Lahore",
    country: "Pakistan",
  },
  phone: "0300 020 2902",
  phoneHref: "tel:+923000202902",
  whatsappHref: "https://wa.me/923000202902",
  // Observed from 12,493 real door scans since 1 September 2026. Confirm the
  // posted hours with the club before treating these as official.
  hours: {
    weekdays: "7:00 am – 11:30 pm",
    saturday: "7:00 am – 11:30 pm",
    sunday: "Closed",
    note: "Quietest before 4 pm. Busiest between 6 and 9 in the evening.",
  },
};

export const hero = {
  eyebrow: "Paragon City, Lahore",
  headline: ["Strength is built,", "not bought."],
  sub:
    "A full strength floor, separate male and female sections, nine certified trainers, " +
    "and recovery most gyms in Lahore do not have. Come and use it for a day before you decide.",
  primaryCta: { label: "Book a day pass — Rs 1,000", href: "#enquire" },
  secondaryCta: { label: "See memberships", href: "#memberships" },
  stats: [
    { value: "534", label: "members training here" },
    { value: "9", label: "certified trainers" },
    { value: "2", label: "separate sections" },
    { value: "16h", label: "open every weekday" },
  ],
  tags: [
    "Separate female section",
    "Jacuzzi",
    "Ice plunge",
    "Steam & sauna",
    "Physiotherapy",
    "Pilates",
    "CrossFit",
    "MMA",
    "Zumba",
    "Snooker & pool",
    "Kids play area",
  ],
};

export interface Pillar {
  n: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}

export const pillars: Pillar[] = [
  {
    n: "01",
    title: "The strength floor",
    body:
      "Free weights, machines and a functional area that is not an afterthought. " +
      "The room people actually come back for.",
    href: "#memberships",
    linkLabel: "See the plans",
  },
  {
    n: "02",
    title: "Personal training",
    body:
      "Four coaching tiers with nine certified trainers across strength and conditioning, " +
      "weight loss and general fitness. Priced per person, not per package.",
    href: "#trainers",
    linkLabel: "Meet the trainers",
  },
  {
    n: "03",
    title: "Recovery",
    body:
      "Jacuzzi, ice plunge, steam room and sauna, plus physiotherapy on site. " +
      "Bundled into a membership or paid for by the session.",
    href: "#recovery",
    linkLabel: "What is included",
  },
  {
    n: "04",
    title: "Classes & sport",
    body:
      "Pilates, Zumba, CrossFit and MMA, plus table tennis, snooker and pool — " +
      "and a supervised play area so the kids are not the reason you skip.",
    href: "#memberships",
    linkLabel: "See the plans",
  },
];

export interface Plan {
  name: string;
  monthly: number | null;
  admission: boolean;
  blurb: string;
  featured?: boolean;
  femaleOnly?: boolean;
  includes?: string[];
}

export const ADMISSION_FEE = 15000;

export const planGroups: { id: string; label: string; note: string; plans: Plan[] }[] = [
  {
    id: "core",
    label: "Memberships",
    note: `A one-time admission fee of Rs ${ADMISSION_FEE.toLocaleString()} applies to these.`,
    plans: [
      {
        name: "Gym",
        monthly: 10000,
        admission: true,
        blurb: "Build strength. Build you.",
        includes: ["Full strength floor", "Cardio", "Locker & changing rooms"],
      },
      {
        name: "Hybrid",
        monthly: 12000,
        admission: true,
        femaleOnly: true,
        blurb: "Strength. Cardio. Functional.",
        includes: ["Female section only", "Strength & cardio", "Functional training"],
      },
      {
        name: "CrossFit",
        monthly: 8000,
        admission: true,
        blurb: "Stronger everyday. Better everyday.",
        includes: ["CrossFit area", "Coached sessions"],
      },
      {
        name: "MMA",
        monthly: 8000,
        admission: true,
        blurb: "Mixed martial arts training.",
        includes: ["MMA hall", "Coached sessions"],
      },
      {
        name: "Zumba",
        monthly: 12000,
        admission: true,
        blurb: "Dance. Sweat. Feel alive.",
        includes: ["Dedicated studio", "Separate female entrance"],
      },
      {
        name: "Pilates",
        monthly: 20000,
        admission: true,
        blurb: "Strength + mobility + balance.",
        includes: ["4 sessions per week", "Studio equipment", "Rs 2,500 for a single session"],
      },
    ],
  },
  {
    id: "vaults",
    label: "Gym + recovery",
    note: "Everything in the Gym membership, plus recovery. Admission fee applies.",
    plans: [
      {
        name: "Wellness Vault",
        monthly: 12000,
        admission: true,
        blurb: "Gym, and somewhere to recover.",
        includes: ["Full gym access", "4 jacuzzi sessions a month"],
      },
      {
        name: "Recovery Vault",
        monthly: 18000,
        admission: true,
        blurb: "Train hard. Recover properly.",
        includes: ["Full gym access", "4 jacuzzi sessions", "4 ice plunge sessions"],
      },
      {
        name: "Infinity Vault",
        monthly: 25000,
        admission: true,
        featured: true,
        blurb: "Everything the club has.",
        includes: [
          "Full gym access",
          "4 jacuzzi + 2 ice plunge sessions",
          "10 frames snooker + 10 frames pool",
          "Table tennis",
          "Unlimited chess & carrom",
        ],
      },
    ],
  },
  {
    id: "single",
    label: "Pay as you go",
    note: "No admission fee, no commitment. Walk in and pay for what you use.",
    plans: [
      { name: "Day Pass", monthly: 1000, admission: false, blurb: "One full day, everything open to you.", featured: true },
      { name: "Physiotherapy", monthly: 2500, admission: false, blurb: "Per session, on site." },
      { name: "Pilates", monthly: 2500, admission: false, blurb: "Single session." },
      { name: "Ice Plunge", monthly: 2000, admission: false, blurb: "Per session." },
      { name: "Jacuzzi", monthly: 1000, admission: false, blurb: "Per session." },
      { name: "Steam & Sauna", monthly: 1000, admission: false, blurb: "Per session." },
      { name: "Nutritionist", monthly: 6000, admission: false, blurb: "Monthly nutrition plan." },
      { name: "Table Tennis", monthly: 5000, admission: false, blurb: "Monthly membership." },
      { name: "Table Tennis + Coach", monthly: 15000, admission: false, blurb: "Monthly, with a personal coach." },
      { name: "Kids Play Area", monthly: 4000, admission: false, blurb: "A safe, supervised space for your little champions." },
    ],
  },
];

// Deliberately has no price on the page. PT is negotiated per client, and the
// rates currently in use are not for publication without the owner's say-so.
export const personalTraining = {
  tiers: ["Bronze", "Silver", "Gold", "Platinum"],
  blurb:
    "Four coaching tiers, matched to how often you train and who you train with. " +
    "Priced per person after a conversation about what you actually want — " +
    "there is no list price, because no two plans are the same.",
  note: "A gym membership is charged separately from personal training.",
  cta: { label: "Ask about personal training", href: "#enquire" },
};

export interface Trainer {
  name: string;
  speciality: string;
  note?: string;
}

// Names come from the system's public trainer directory. No photos exist yet
// — the cards fall back to initials until they do.
export const trainers: Trainer[] = [
  { name: "Muneeb Ahmed", speciality: "Strength & Conditioning" },
  { name: "Fizza Salman", speciality: "Strength & Conditioning", note: "5 years of experience" },
  { name: "Rana Zeeshan Iftikhar", speciality: "Strength & Conditioning" },
  { name: "Abdullah Arshad", speciality: "Strength & Conditioning" },
  { name: "Khalid Saeed", speciality: "Cardio & Weight Loss" },
  { name: "Robin Gulzar", speciality: "General Fitness" },
  { name: "Muhammad Haseeb", speciality: "General Fitness" },
  { name: "Asim Qureshi", speciality: "Table Tennis Coaching" },
  { name: "Syeda Faiza Ejaz", speciality: "Personal Training" },
];

export const recovery = [
  { name: "Jacuzzi", price: "Rs 1,000", unit: "per session" },
  { name: "Ice Plunge", price: "Rs 2,000", unit: "per session" },
  { name: "Steam Room & Sauna", price: "Rs 1,000", unit: "per session" },
  { name: "Physiotherapy", price: "Rs 2,500", unit: "per session" },
];

export const facilities = [
  "Strength & free weights floor",
  "Cardio",
  "CrossFit area",
  "MMA hall",
  "Pilates studio",
  "Zumba studio",
  "Jacuzzi",
  "Ice plunge",
  "Steam room & sauna",
  "Physiotherapy room",
  "Snooker & pool",
  "Table tennis",
  "Chess & carrom",
  "Kids play area",
  "Nutritionist consultation",
  "Separate female section",
];

export const whoWeAre = {
  heading: "Built for Lahore, not copied from somewhere else.",
  body: [
    "Level Up is an independent club on the 3rd floor of High Street Mall in Paragon City. " +
      "Not a franchise, not a chain — one floor, run by the people who own it.",
    "The female section has its own entrance, its own studio and its own schedule, " +
      "which is the reason a lot of our members chose us over somewhere closer to home.",
    "534 people train here. Nine certified trainers work the floor. " +
      "And the recovery room — jacuzzi, ice plunge, steam and sauna — is not an " +
      "upsell bolted on later; it is bundled into three of our memberships.",
  ],
  points: [
    { title: "Separate female section", body: "Own entrance, own studio, own schedule." },
    { title: "Nine certified trainers", body: "Strength, conditioning, weight loss, general fitness." },
    { title: "Recovery on site", body: "Jacuzzi, ice plunge, steam, sauna and physiotherapy." },
  ],
};

export const enquiry = {
  heading: "Start with a day pass",
  body:
    "Rs 1,000 gets you a full day with everything open to you — the floor, the classes " +
    "running that day, and the recovery room. Decide afterwards.",
  interests: [
    "Gym membership",
    "Personal training",
    "Female section",
    "Pilates or Zumba",
    "CrossFit or MMA",
    "Recovery only",
    "Kids play area",
    "Something else",
  ],
};

export const nav = [
  { label: "What we do", href: "#what-we-do" },
  { label: "About", href: "#about" },
  { label: "Memberships", href: "#memberships" },
  { label: "Trainers", href: "#trainers" },
  { label: "Visit", href: "#visit" },
];
