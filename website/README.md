# Level Up Fitness Club — public website

A **separate application** that happens to live in the management app's
repository. One repo, two deployments.

| | Management app | This website |
|---|---|---|
| Location | repo root | `website/` |
| Package | `levelup-gym` | `levelup-website` |
| Dev port | 3000 | **3100** |
| Database | Supabase | **none** |
| Audience | gym staff, behind a login | the public |

They share a repository and a brand. They share **no code, no dependencies
and no runtime**. The website has no Supabase client, no environment
variables, no API routes and no middleware — it is fully static HTML.

## Running it

```bash
cd website
npm install
npm run dev        # http://localhost:3100
```

Running the management app at the same time is fine; the ports differ.

## Editing content

**Everything is in [`src/content/site.ts`](src/content/site.ts)** — prices,
plan names, trainers, opening hours, phone number, every line of copy. Change
a price there and it changes everywhere on the page.

Nothing is read from the database. That is deliberate: a public site must stay
up when Supabase is down, and it must be impossible for it to leak member
data. The cost is that **a price change in the gym does not appear here until
someone edits this file.**

## Deploying

A **second Vercel project**, pointed at the same GitHub repository, with:

- **Root Directory** → `website`
- Framework → Next.js (detected)
- No environment variables

The existing `levelup-gym` project keeps Root Directory `.` and is untouched.
Both rebuild on a push to `main`; set an Ignored Build Step on each later if
the wasted builds become annoying.

## Things that bite

- **`turbopack.root` is pinned in `next.config.ts`.** Two lockfiles exist in
  this tree, and without the pin Next walks up, finds the parent's lockfile
  first and treats the repo root as the workspace — pulling the management
  app's middleware and config into a build that must stay independent.
- **The root `tsconfig.json` excludes `website`.** Its include globs are
  `**/*.ts(x)`, so otherwise the management app type-checks this app's files
  against its own `@/*` paths and fails.
- **The enquiry form submits to WhatsApp**, not to a server. There is no
  backend here to receive a lead. See the comment in
  `src/components/EnquiryForm.tsx` for how to point it at the gym's own
  submissions table instead.

## Not done yet

- No photographs anywhere — the floor, the recovery room and the trainers all
  need real images. Trainer cards fall back to initials.
- Opening hours are **derived from door scans**, not from a posted schedule.
- No class timetable; that data does not exist in the system.
- No Google Maps embed, no reviews, no transformations section.
