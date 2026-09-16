import sharp from "sharp";

// Server-side image optimization for the upload paths that accept images:
// member profile photos, POS product photos, and document images
// (CNIC/medical scans — handled far more gently, see processDocumentImage).
//
// These throw ImageProcessingError on any decode/processing failure rather
// than falling back to storing the original bytes. That fallback was this
// module's first design, but it let a multi-megabyte source file bypass
// optimization entirely whenever sharp couldn't decode it — exactly the
// outcome the optimization requirement exists to prevent. Callers must
// catch ImageProcessingError and reject the upload with a safe message;
// they must never store `input` unprocessed as a substitute.

export class ImageProcessingError extends Error {}

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

// "error" tolerates the kind of minor non-fatal warning some real-world
// phone-camera JPEGs trigger in libvips (odd EXIF segments, etc.) while
// still failing on genuinely corrupt/truncated data — the deliberate
// middle ground between sharp's stricter "warning" default (would rejected
// legitimate photos) and "none" (would decode almost anything, including
// the corrupt-but-magic-byte-valid files this change is meant to catch).
function openImage(input: Buffer): sharp.Sharp {
  return sharp(input, { failOn: "error" });
}

async function encodeWebpUnderTarget(
  pipeline: sharp.Sharp,
  targetBytes: number,
  { startQuality = 82, minQuality = 40, step = 12 }: { startQuality?: number; minQuality?: number; step?: number } = {}
): Promise<Buffer> {
  let quality = startQuality;
  let buf = await pipeline.clone().webp({ quality }).toBuffer();
  while (buf.length > targetBytes && quality > minQuality) {
    quality -= step;
    buf = await pipeline.clone().webp({ quality }).toBuffer();
  }
  return buf;
}

/** Member/profile photos: ≤1024×1024, WebP, target ~100-250KB, hard
 *  ceiling ~500KB. Used by both public registration and the dashboard
 *  member-photo update flow — one shared function, one consistent result. */
export async function processProfileImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const oriented = openImage(input).rotate(); // auto-orients from EXIF, then drops the tag
    const resized = oriented.resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true });

    let buffer = await encodeWebpUnderTarget(resized, 250 * 1024, { startQuality: 82, minQuality: 40 });

    if (buffer.length > 500 * 1024) {
      // Still over the hard ceiling even at floor quality (rare — very
      // busy/high-entropy source image) — shrink dimensions too.
      buffer = await openImage(input)
        .rotate()
        .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 40 })
        .toBuffer();
    }

    return { buffer, contentType: "image/webp", ext: "webp" };
  } catch (err) {
    throw new ImageProcessingError(`profile photo optimization failed: ${(err as Error).message}`);
  }
}

/** POS product photos: ≤1200×1200, WebP, target ~150-350KB. */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const oriented = openImage(input).rotate();
    const resized = oriented.resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true });

    let buffer = await encodeWebpUnderTarget(resized, 350 * 1024, { startQuality: 85, minQuality: 45 });

    if (buffer.length > 500 * 1024) {
      buffer = await openImage(input)
        .rotate()
        .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 45 })
        .toBuffer();
    }

    return { buffer, contentType: "image/webp", ext: "webp" };
  } catch (err) {
    throw new ImageProcessingError(`product photo optimization failed: ${(err as Error).message}`);
  }
}

/** Document images (CNIC/ID/medical scans — never PDFs, those pass
 *  through untouched by the caller before this is even invoked): only
 *  down-scale if larger than ~1600px on the longest side, fixed high
 *  quality, no target-byte-size squeeze. Readability over file size. Still
 *  throws (rather than storing the original) on a genuinely undecodable
 *  file — the gentler processing here is about quality/resize policy, not
 *  about tolerating corrupt input as if it were a valid image. */
export async function processDocumentImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const image = openImage(input).rotate();
    const meta = await image.clone().metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);

    const pipeline = longest > 1600
      ? image.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      : image;

    const buffer = await pipeline.webp({ quality: 90 }).toBuffer();
    return { buffer, contentType: "image/webp", ext: "webp" };
  } catch (err) {
    throw new ImageProcessingError(`document image optimization failed: ${(err as Error).message}`);
  }
}
