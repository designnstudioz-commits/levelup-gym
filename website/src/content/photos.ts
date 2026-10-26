// The photo brief.
//
// Every image the site needs, in one list. The page renders a labelled empty
// frame wherever one is missing, and /photos turns the same list into a shot
// list the client can read and shoot against. Add `src` to a slot and both the
// frame and the "still needed" count update themselves — there is no second
// place to remember.
//
// Keep `detail` written for the person holding the camera, not for a
// developer: what should be in frame, and what makes the shot wrong.

export interface Photo {
  /** Printed on the frame and in the shot list, so a file can be named for it. */
  id: string;
  section: string;
  title: string;
  detail: string;
  /** CSS aspect-ratio for the frame. */
  ratio: string;
  orientation: "Landscape" | "Portrait" | "Square";
  minWidth: number;
  priority: "Essential" | "Important" | "Nice to have";
  /** Set this to a path in /public once the real photo arrives. */
  src?: string;
}

export const photos: Photo[] = [
  // ── Hero ───────────────────────────────────────────────────────────────
  {
    id: "HERO-01",
    section: "Top of the page",
    title: "The main shot — the strength floor in use",
    detail:
      "Wide view across the weights floor with three or four people actually training, " +
      "not posing. Shoot in the evening when the lights are on and the room is busy. " +
      "This is the first thing anyone sees, so it has to look like a serious gym. " +
      "Avoid: empty room, harsh flash, phone portrait mode.",
    ratio: "16/9",
    orientation: "Landscape",
    minWidth: 2400,
    priority: "Essential",
  },

  // ── 01 What we do ──────────────────────────────────────────────────────
  {
    id: "DO-01",
    section: "01 · What we do",
    title: "Strength floor",
    detail: "Racks, barbells and dumbbells. One person mid-set is ideal.",
    ratio: "4/3",
    orientation: "Landscape",
    minWidth: 1200,
    priority: "Essential",
  },
  {
    id: "DO-02",
    section: "01 · What we do",
    title: "A trainer coaching someone",
    detail:
      "A trainer actually correcting form, both faces visible. This sells personal " +
      "training better than any photo of equipment.",
    ratio: "4/3",
    orientation: "Landscape",
    minWidth: 1200,
    priority: "Essential",
  },
  {
    id: "DO-03",
    section: "01 · What we do",
    title: "Recovery room",
    detail: "Jacuzzi or ice plunge, clean and lit. Nobody has to be in it.",
    ratio: "4/3",
    orientation: "Landscape",
    minWidth: 1200,
    priority: "Essential",
  },
  {
    id: "DO-04",
    section: "01 · What we do",
    title: "A class in progress",
    detail: "Zumba, Pilates or CrossFit — a group mid-session, energy visible.",
    ratio: "4/3",
    orientation: "Landscape",
    minWidth: 1200,
    priority: "Essential",
  },

  // ── 02 Who we are ──────────────────────────────────────────────────────
  {
    id: "ABOUT-01",
    section: "02 · Who we are",
    title: "The female section",
    detail:
      "Its own entrance, studio or floor. This is the single biggest reason members " +
      "choose us, and right now we have nothing to show for it. Shoot it empty if " +
      "members would rather not be photographed.",
    ratio: "3/4",
    orientation: "Portrait",
    minWidth: 1200,
    priority: "Essential",
  },

  // ── 04 Recovery ────────────────────────────────────────────────────────
  { id: "REC-01", section: "04 · Recovery", title: "Jacuzzi", detail: "Clean, lit, water on.", ratio: "1/1", orientation: "Square", minWidth: 900, priority: "Important" },
  { id: "REC-02", section: "04 · Recovery", title: "Ice plunge", detail: "The tub itself. Steam or ice visible if possible.", ratio: "1/1", orientation: "Square", minWidth: 900, priority: "Important" },
  { id: "REC-03", section: "04 · Recovery", title: "Steam room / sauna", detail: "Interior, lit, door open.", ratio: "1/1", orientation: "Square", minWidth: 900, priority: "Important" },
  { id: "REC-04", section: "04 · Recovery", title: "Physiotherapy room", detail: "Treatment bed and equipment, tidy.", ratio: "1/1", orientation: "Square", minWidth: 900, priority: "Important" },

  // ── 06 The floor ───────────────────────────────────────────────────────
  { id: "FLOOR-01", section: "06 · The floor", title: "Dumbbell rack", detail: "Full rack, straight on. Show how heavy they go.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Important" },
  { id: "FLOOR-02", section: "06 · The floor", title: "Squat racks / platforms", detail: "The serious end of the room.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Important" },
  { id: "FLOOR-03", section: "06 · The floor", title: "Machines", detail: "A clean row of resistance machines down the lens.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Important" },
  { id: "FLOOR-04", section: "06 · The floor", title: "Cardio line", detail: "Treadmills and bikes, ideally with people on them.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Important" },
  { id: "FLOOR-05", section: "06 · The floor", title: "MMA hall or CrossFit area", detail: "Mats, bags, rigs.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Important" },
  { id: "FLOOR-06", section: "06 · The floor", title: "Snooker, pool or table tennis", detail: "The games area — nobody expects this in a gym, so show it.", ratio: "4/5", orientation: "Portrait", minWidth: 1000, priority: "Nice to have" },

  // ── 07 Visit ───────────────────────────────────────────────────────────
  {
    id: "VISIT-01",
    section: "07 · Come and see it",
    title: "Reception",
    detail: "The desk as you walk in, with someone behind it. First impression of the club.",
    ratio: "16/10",
    orientation: "Landscape",
    minWidth: 1600,
    priority: "Essential",
  },
  {
    id: "VISIT-02",
    section: "07 · Come and see it",
    title: "The way in from outside",
    detail:
      "High Street Mall entrance or the 3rd-floor door with signage visible, so a " +
      "first-time visitor knows what to look for. Daylight.",
    ratio: "16/10",
    orientation: "Landscape",
    minWidth: 1600,
    priority: "Important",
  },
];

// Trainer headshots are listed separately: there is one per person, and the
// names come from the system rather than being written here.
export const trainerPhotoBrief = {
  ratio: "1/1",
  orientation: "Square" as const,
  minWidth: 800,
  detail:
    "Head and shoulders, plain or gym background, looking at the camera. " +
    "Shoot all of them the same way on the same day — a page of mismatched " +
    "selfies looks worse than the initials we show now.",
};

export const photoById = Object.fromEntries(photos.map((p) => [p.id, p])) as Record<string, Photo>;

export const photoStats = {
  total: photos.length,
  supplied: photos.filter((p) => p.src).length,
  get outstanding() { return this.total - this.supplied; },
};
