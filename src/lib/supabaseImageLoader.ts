/**
 * Custom next/image loader — resizes via Supabase Storage instead of Vercel.
 *
 * WHY: on 2026-10-05 every avatar that wasn't already edge-cached started
 * rendering as "Photo needs re-upload". The photos were fine; Vercel's image
 * optimiser was returning
 *   HTTP 402  X-Vercel-Error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED
 * because the plan's Image Optimization allowance was spent. Cached sizes
 * (56px list rows) kept working while uncached ones (112px profile header)
 * failed, which is why it looked like a per-member bug.
 *
 * Serving the originals unresized was not an option: 477 member photos
 * average 257 KB and the largest is 4.2 MB, so a 50-row member list would
 * pull ~12 MB to draw 56px circles.
 *
 * Supabase Storage does the same job on the storage plan this project
 * already pays for, with its own CDN cache, and costs nothing per Vercel
 * request. Same source file at 112px: 38 KB -> 3.3 KB.
 *
 * Every image this app renders through next/image lives in a public bucket
 * on this project's own storage host (member photos, POS product images),
 * so the rewrite below is the whole job. Anything else — a local /public
 * asset, a future third-party host — falls through untouched and is served
 * as-is rather than silently breaking.
 */

/** Supabase rejects a width outside this range; Next can ask for up to 3840. */
const MAX_WIDTH = 2500;

/** The public-object path prefix we can swap for the rendering one. */
const PUBLIC_OBJECT = "/storage/v1/object/public/";
const RENDER_IMAGE = "/storage/v1/render/image/public/";

export default function supabaseImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  // Not a Supabase public object (local asset, blob:, data:, other host) —
  // hand it back unchanged. Returning it verbatim is correct: with a custom
  // loader Next does no optimising of its own, so this is just "serve it".
  if (!src.includes(PUBLIC_OBJECT)) return src;

  const [base, existingQuery] = src.split("?");
  const rendered = base.replace(PUBLIC_OBJECT, RENDER_IMAGE);

  // Square, cover-cropped. Every consumer renders in a fixed box with
  // object-cover, so this is the same crop the browser would do, done
  // server-side. Width-only is NOT safe: for a 3:4 portrait Supabase returned
  // a 112x1024 strip (verified 2026-10-05), and the browser then cropped the
  // middle of that strip - which cut member faces out of their circles.
  // Supabase cover is centred, which keeps the face for ordinary headshots.
  const size = Math.min(Math.round(width), MAX_WIDTH);
  const params = new URLSearchParams(existingQuery);
  params.set("width", String(size));
  params.set("height", String(size));
  params.set("resize", "cover");
  // Supabase accepts 20-100. Next's default is 75 when unspecified.
  params.set("quality", String(Math.min(Math.max(quality ?? 75, 20), 100)));

  return `${rendered}?${params.toString()}`;
}
