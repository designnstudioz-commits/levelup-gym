// Shared hardening for the two public, unauthenticated upload endpoints
// (/api/upload/photo, /api/upload/document) — both are reachable from the
// public registration form before any account exists, so neither can
// require a session. This is the smallest safe surface for that
// constraint: verify the bytes actually are what they claim to be, never
// trust a client-supplied filename/extension/MIME on its own, generate
// every storage path server-side, and best-effort throttle repeat callers.

/** Magic-byte signatures for the only image formats the app accepts.
 *  Client-supplied `file.type` is trivially spoofable (it's just a form
 *  field) — this is what actually gates content, not the MIME string. */
export type SniffedImageType = "jpeg" | "png" | "webp" | "heic";

export async function sniffImageType(file: File): Promise<SniffedImageType | null> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";

  if (
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) return "png";

  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // "RIFF"
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // "WEBP"
  ) return "webp";

  // HEIC/HEIF: an ISO-BMFF container — bytes 4-7 spell "ftyp", followed by
  // a brand. Good enough to reject anything that isn't actually one of
  // these container brands; not a full HEIF parse.
  const asAscii = Array.from(head.slice(4, 8)).map((b) => String.fromCharCode(b)).join("");
  if (asAscii === "ftyp") {
    const brand = Array.from(head.slice(8, 24)).map((b) => String.fromCharCode(b)).join("");
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brand)) return "heic";
  }

  return null;
}

export async function sniffIsPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const sig = Array.from(head).map((b) => String.fromCharCode(b)).join("");
  return sig === "%PDF-";
}

export const IMAGE_EXTENSION: Record<SniffedImageType, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  heic: "heic",
};

/** Best-effort per-IP throttle. This runs in a stateless serverless
 *  function — the in-memory map only persists for the lifetime of one warm
 *  instance, so it does NOT provide a hard guarantee across instances or
 *  regions. It still meaningfully slows down a naive scripted abuser
 *  hitting a single warm instance, which is the realistic threat here
 *  (there is no Redis/Upstash in this stack to do it properly — see the
 *  security audit's note on this being an accepted, documented gap). */
const rateLimitBuckets = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateLimitBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    rateLimitBuckets.set(key, hits);
    return false;
  }
  hits.push(now);
  rateLimitBuckets.set(key, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded on a
  // long-lived warm instance.
  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets) {
      if (v.every((t) => now - t > windowMs)) rateLimitBuckets.delete(k);
    }
  }
  return true;
}

export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function generateStoragePath(prefix: string, ext: string): string {
  const rand = crypto.randomUUID();
  return `${prefix}/${Date.now()}-${rand}.${ext}`;
}
