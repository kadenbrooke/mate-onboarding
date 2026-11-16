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
// Memory (KVM2 runs Mate under mem_limit 768m). A full decode is large:
// measured peak RSS 389 MB for 12 MP, 636 MB for 24 MP, 1055 MB for 48 MP,
// and the WebAssembly heap is never handed back to the OS (a worker thread did
// not release it either). So, in order:
//   1. The size is read from the HEIC header (the ispe property) BEFORE any
//      decode, and anything over MAX_PIXELS or MAX_SIDE_PX is refused.
//   2. Conversions run one at a time (an in-process queue), so two uploads
//      cannot stack.
//   3. Each conversion runs in a short-lived child process that exits when
//      done, which returns every byte to the OS. The child gets no secrets
//      (PATH and NODE_ENV only) and raises its own OOM score, so if the container is ever
//      squeezed the kernel kills the conversion, not Mate.
//
// The stored evidence stays the original upload. Only the copy sent to the
// model is converted.

import { spawn } from 'node:child_process';

/** Longest edge sent to the model. Vision models downscale past ~1600px anyway. */
export const MAX_EDGE_PX = 2048;
/** Covers the 24 MP iPhone default (5712x4284); refuses 48 MP (8064x6048). */
export const MAX_PIXELS = 25_000_000;
export const MAX_SIDE_PX = 8192;
/** A conversion that has not finished by then is killed. */
const CONVERT_TIMEOUT_MS = 30_000;

export type HeicConversion =
  | { ok: true; bytes: Uint8Array; mime: 'image/jpeg' }
  | { ok: false; reason: 'too-large'; width: number; height: number }
  | { ok: false; reason: 'unreadable'; detail: string };

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/**
 * The image size a HEIC declares, without decoding it: the largest ispe
 * (image spatial extents) property inside the top-level meta box. A grid
 * image's ispe is the full picture and its tiles and thumbnail are smaller, so
 * the largest one is the size a decode would produce. null when there is no
 * meta box or no ispe, which the caller treats as unreadable.
 */
export function heicDimensions(b: Uint8Array): { width: number; height: number } | null {
  // Walk the top-level boxes: [u32 size][4cc type], size 1 = 64-bit size follows, 0 = to end.
  let at = 0;
  while (at + 8 <= b.length) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > b.length) return null;
      size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = b.length - at;
    }
    if (size < header) return null;
    if (type === 'meta') {
      const end = Math.min(at + size, b.length);
      let width = 0;
      let height = 0;
      // ispe is a full box: [size][ispe][version+flags u32][width u32][height u32].
      for (let i = at + header; i + 16 <= end; i++) {
        if (b[i] === 0x69 && fourcc(b, i) === 'ispe') {
          width = Math.max(width, u32(b, i + 8));
          height = Math.max(height, u32(b, i + 12));
        }
      }
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += size;
  }
  return null;
}

// Runs in the child. CommonJS via `node -e`, so require resolves from the
// working directory's node_modules (the repo locally, /app in the container).
const CHILD = `
try { require('fs').writeFileSync('/proc/self/oom_score_adj', '1000') } catch {}
const chunks = []
process.stdin.on('data', c => chunks.push(c)).on('end', async () => {
  try {
    const img = await require('heic-decode')({ buffer: Buffer.concat(chunks) })
    const jpeg = await require('sharp')(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
      raw: { width: img.width, height: img.height, channels: 4 },
    })
      .resize({ width: ${MAX_EDGE_PX}, height: ${MAX_EDGE_PX}, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    process.stdout.write(jpeg)
  } catch (e) {
    process.stderr.write(String((e && e.message) || e))
    process.exit(1)
  }
})
`;

function convertInChild(heic: Uint8Array): Promise<HeicConversion> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', CHILD], {
      cwd: process.cwd(),
      // No secrets in a child: PATH and NODE_ENV only, never process.env.
      env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), CONVERT_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', e => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'unreadable', detail: e.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(out);
      if (code === 0 && jpeg.length > 0) resolve({ ok: true, bytes: new Uint8Array(jpeg), mime: 'image/jpeg' });
      else resolve({ ok: false, reason: 'unreadable', detail: (err || `child exited ${code ?? signal}`).slice(0, 300) });
    });
    child.stdin.on('error', () => { /* the child died early; close reports it */ });
    child.stdin.end(Buffer.from(heic));
  });
}

// One conversion at a time across the whole process.
let queue: Promise<unknown> = Promise.resolve();

export function heicToJpeg(heic: Uint8Array): Promise<HeicConversion> {
  const size = heicDimensions(heic);
  if (!size) return Promise.resolve({ ok: false, reason: 'unreadable', detail: 'no image size in the HEIC header' });
  if (size.width * size.height > MAX_PIXELS || size.width > MAX_SIDE_PX || size.height > MAX_SIDE_PX) {
    return Promise.resolve({ ok: false, reason: 'too-large', ...size });
  }
  const run = queue.then(() => convertInChild(heic));
  queue = run.catch(() => {});
  return run;
}
