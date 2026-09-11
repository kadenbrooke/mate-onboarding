// Upload validation for Lead Snapshot images.
//
// Content type is SNIFFED from magic bytes, never trusted from the multipart
// part's declared type. A client can claim anything; what we forward to a
// vision model and store as consent evidence should be what the bytes actually
// are.
//
// ---------------------------------------------------------------------------
// HEIC, and why it is passed through rather than transcoded
// ---------------------------------------------------------------------------
//
// HEIC is the iPhone default, so it is the format this feature will meet most
// often. The spec left "confirm Gemini accepts it, or transcode server side"
// open. Both halves were probed on 2026-09-10:
//
//   Transcode: NOT AVAILABLE. sharp 0.34.5 is already a dependency, but its
//   prebuilt binary reports heif input with fileSuffix ['.avif'] only, and a
//   real HEIC fails to decode ("source: bad seek"). HEIC decode needs a custom
//   libvips build with libheif, which is a deploy-time change to the Vercel
//   runtime, not a code change.
//
//   Pass through: UNVERIFIED. Google documents HEIC and HEIF as accepted Gemini
//   image inputs, but the live probe could not confirm it: the Gemini key
//   returned 429 RESOURCE_EXHAUSTED (prepay credits depleted) for HEIC AND for
//   a JPEG control, so nothing was learned about the format. The gateway itself
//   is healthy, the OpenAI path answered normally.
//
// So HEIC is accepted and forwarded as-is, and LEAD_SNAPSHOT_ALLOW_HEIC=0
// turns that off if the live probe in Phase C shows Gemini rejecting it. That
// flag is the escape hatch; the fix if it trips is either a libheif-enabled
// build or client-side conversion before upload.
//
// Worth knowing before panicking about this: iOS Safari usually transcodes HEIC
// to JPEG when a photo goes through a file input, so the camera-capture path
// this feature is built around may rarely produce a HEIC at all.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 5;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';

export const MIME_BY_KIND: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export const EXT_BY_KIND: Record<ImageKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  heic: 'heic',
};

/** ISO base media file brands that mean "this is a HEIC/HEIF still image". */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif']);

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return '';
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Identify an image from its leading bytes. Null for anything unrecognised,
 * which the caller turns into a rejection rather than a guess.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // RIFF....WEBP
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  // ISO-BMFF: [4 byte box size]'ftyp'[4 byte brand]
  if (ascii(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 12).toLowerCase())) return 'heic';
  return null;
}

export type ImageRejection =
  | { reason: 'empty' }
  | { reason: 'too-large'; bytes: number }
  | { reason: 'unsupported-type' }
  | { reason: 'heic-disabled' };

export type ImageCheck =
  | { ok: true; kind: ImageKind; mime: string; ext: string; bytes: number }
  | { ok: false; rejection: ImageRejection };

/** The environment this module reads. Structural rather than NodeJS.ProcessEnv
 *  so a test can pass a plain object literal, while process.env still fits. */
export type SnapshotEnv = Record<string, string | undefined>;

/** Whether HEIC uploads are forwarded. See the header note. */
export function heicAllowed(env: SnapshotEnv = process.env): boolean {
  return env.LEAD_SNAPSHOT_ALLOW_HEIC !== '0';
}

/** Validate one uploaded image. Pure: no IO, no network. */
export function checkImage(bytes: Uint8Array, env: SnapshotEnv = process.env): ImageCheck {
  if (bytes.length === 0) return { ok: false, rejection: { reason: 'empty' } };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, rejection: { reason: 'too-large', bytes: bytes.length } };
  }

  const kind = sniffImageKind(bytes);
  if (!kind) return { ok: false, rejection: { reason: 'unsupported-type' } };
  if (kind === 'heic' && !heicAllowed(env)) {
    return { ok: false, rejection: { reason: 'heic-disabled' } };
  }

  return { ok: true, kind, mime: MIME_BY_KIND[kind], ext: EXT_BY_KIND[kind], bytes: bytes.length };
}

/** Plain-language rejection copy. The client reads this, so no jargon. */
export function imageRejectionMessage(r: ImageRejection): string {
  switch (r.reason) {
    case 'empty':
      return 'That file was empty.';
    case 'too-large':
      return `That photo is ${Math.round(r.bytes / 1024 / 1024)} MB. The limit is 10 MB.`;
    case 'unsupported-type':
      return 'That file is not a photo we can read. Use a JPEG, PNG, or WebP.';
    case 'heic-disabled':
      return 'iPhone HEIC photos are not supported right now. Set Camera to Most Compatible, or send a screenshot.';
  }
}

/** The storage path for an image: <session_id>/<snapshot_id>/<n>.<ext>. */
export function storagePathFor(sessionId: string, snapshotId: string, index: number, ext: string): string {
  return `${sessionId}/${snapshotId}/${index}.${ext}`;
}
