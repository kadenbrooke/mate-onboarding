import { describe, it, expect } from 'vitest';
import {
  sniffImageKind,
  checkImage,
  heicAllowed,
  imageRejectionMessage,
  storagePathFor,
  MAX_IMAGE_BYTES,
} from './snapshotImage';

const bytes = (...v: number[]) => new Uint8Array(v);
const pad = (head: Uint8Array, total = 64) => {
  const out = new Uint8Array(total);
  out.set(head);
  return out;
};

const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const asciiBytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));

function isoBmff(brand: string): Uint8Array {
  const out = new Uint8Array(64);
  out.set(bytes(0x00, 0x00, 0x00, 0x20), 0);
  out.set(asciiBytes('ftyp'), 4);
  out.set(asciiBytes(brand), 8);
  return out;
}

function webp(): Uint8Array {
  const out = new Uint8Array(64);
  out.set(asciiBytes('RIFF'), 0);
  out.set(asciiBytes('WEBP'), 8);
  return out;
}

describe('sniffImageKind', () => {
  it('identifies the formats we accept', () => {
    expect(sniffImageKind(JPEG)).toBe('jpeg');
    expect(sniffImageKind(PNG)).toBe('png');
    expect(sniffImageKind(webp())).toBe('webp');
    expect(sniffImageKind(isoBmff('heic'))).toBe('heic');
  });

  it('accepts every HEIF brand an iPhone emits', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'heif']) {
      expect(sniffImageKind(isoBmff(brand))).toBe('heic');
    }
  });

  // The real bytes from a macOS HEIC, checked against the probe on 2026-09-10:
  // 00000020 66747970 68656963 -> size box, 'ftyp', brand 'heic'.
  it('identifies a real HEIC header', () => {
    const real = new Uint8Array(
      Buffer.from('00000020667479706865696300000000', 'hex'),
    );
    expect(sniffImageKind(pad(real))).toBe('heic');
  });

  it('rejects things that are not images', () => {
    expect(sniffImageKind(asciiBytes('%PDF-1.7'))).toBeNull();
    expect(sniffImageKind(asciiBytes('<html>'))).toBeNull();
    expect(sniffImageKind(new Uint8Array(0))).toBeNull();
  });

  it('rejects a non-still ISO-BMFF brand such as plain mp4', () => {
    expect(sniffImageKind(isoBmff('isom'))).toBeNull();
    expect(sniffImageKind(isoBmff('mp42'))).toBeNull();
  });

  it('does not read past the end of a truncated buffer', () => {
    expect(() => sniffImageKind(bytes(0xff))).not.toThrow();
    expect(() => sniffImageKind(bytes(0x00, 0x00, 0x00, 0x20, 0x66))).not.toThrow();
    expect(sniffImageKind(bytes(0xff))).toBeNull();
  });
});

describe('checkImage', () => {
  const env = {};

  it('accepts a JPEG and reports its mime and extension', () => {
    const r = checkImage(JPEG, env);
    expect(r).toEqual({ ok: true, kind: 'jpeg', mime: 'image/jpeg', ext: 'jpg', bytes: JPEG.length });
  });

  it('rejects an empty file', () => {
    expect(checkImage(new Uint8Array(0), env)).toEqual({ ok: false, rejection: { reason: 'empty' } });
  });

  it('rejects a file over the size limit', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(bytes(0xff, 0xd8, 0xff));
    const r = checkImage(big, env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe('too-large');
  });

  it('accepts a file exactly at the limit', () => {
    const atLimit = new Uint8Array(MAX_IMAGE_BYTES);
    atLimit.set(bytes(0xff, 0xd8, 0xff));
    expect(checkImage(atLimit, env).ok).toBe(true);
  });

  it('rejects a PDF renamed as a photo', () => {
    expect(checkImage(asciiBytes('%PDF-1.7 and then some'), env))
      .toEqual({ ok: false, rejection: { reason: 'unsupported-type' } });
  });

  it('passes HEIC through by default', () => {
    expect(checkImage(isoBmff('heic'), env).ok).toBe(true);
  });

  it('rejects HEIC when the escape hatch is set', () => {
    const off = { LEAD_SNAPSHOT_ALLOW_HEIC: '0' };
    expect(checkImage(isoBmff('heic'), off))
      .toEqual({ ok: false, rejection: { reason: 'heic-disabled' } });
    // The flag is HEIC-specific: everything else still works.
    expect(checkImage(JPEG, off).ok).toBe(true);
  });
});

describe('heicAllowed', () => {
  it('defaults to on, and only "0" turns it off', () => {
    expect(heicAllowed({})).toBe(true);
    expect(heicAllowed({ LEAD_SNAPSHOT_ALLOW_HEIC: '1' })).toBe(true);
    expect(heicAllowed({ LEAD_SNAPSHOT_ALLOW_HEIC: '0' })).toBe(false);
  });
});

describe('imageRejectionMessage', () => {
  it('is plain language with no em dashes', () => {
    const all = [
      { reason: 'empty' as const },
      { reason: 'too-large' as const, bytes: 12 * 1024 * 1024 },
      { reason: 'unsupported-type' as const },
      { reason: 'heic-disabled' as const },
    ];
    for (const r of all) {
      const msg = imageRejectionMessage(r);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain('—');
    }
  });

  it('names the actual size in the too-large message', () => {
    expect(imageRejectionMessage({ reason: 'too-large', bytes: 12 * 1024 * 1024 })).toContain('12 MB');
  });
});

describe('storagePathFor', () => {
  it('nests by session then snapshot so one delete removes a whole upload', () => {
    expect(storagePathFor('sess', 'snap', 0, 'jpg')).toBe('sess/snap/0.jpg');
  });
});
