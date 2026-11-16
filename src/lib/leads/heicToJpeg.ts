// HEIC/HEIF -> JPEG for the Lead Snapshot reader.
//
// iPhones shoot HEIC. The reader (Claude, with an OpenAI fallback) takes only
// jpeg/png/gif/webp and answers 400 for image/heic (probed 2026-11-16), so a
// HEIC upload is converted here before the vision call.
//
// Why not sharp alone: its prebuilt libvips carries libheif with the AV1 (AVIF)
// decoder only. A real iPhone HEIC is HEVC, and sharp fails it with "Support
// for this compression format has not been built in", both on macOS and in the
// KVM2 base image (node:22.23.3-alpine, checked 2026-11-16). heic-decode wraps
// libheif compiled to WebAssembly (libheif-js), so it needs no native build and
// runs the same in that container; sharp then encodes the JPEG.
//
// The stored evidence stays the original upload. Only the copy sent to the
// model is converted.

import sharp from 'sharp';

/** Longest edge sent to the model. Vision models downscale past ~1600px anyway. */
export const MAX_EDGE_PX = 2048;

export type HeicConversion =
  | { ok: true; bytes: Uint8Array; mime: 'image/jpeg' }
  | { ok: false; detail: string };

export async function heicToJpeg(heic: Uint8Array): Promise<HeicConversion> {
  try {
    // Loaded on first use: the WebAssembly module is large and only HEIC needs it.
    const { default: decode } = await import('heic-decode');
    const image = await decode({ buffer: heic });
    const rgba = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const jpeg = await sharp(rgba, { raw: { width: image.width, height: image.height, channels: 4 } })
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(jpeg), mime: 'image/jpeg' };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
