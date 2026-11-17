// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { sniffImageKind } from './snapshotImage';

// Count the conversion children (the real spawn still runs) to prove a too-large
// HEIC never reaches a decode and that conversions never overlap.
const h = vi.hoisted(() => ({ spawned: 0, active: 0, maxActive: 0 }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: ((...args: Parameters<typeof actual.spawn>) => {
      h.spawned++;
      h.active++;
      h.maxActive = Math.max(h.maxActive, h.active);
      const child = actual.spawn(...args);
      child.on('close', () => { h.active--; });
      return child;
    }) as typeof actual.spawn,
  };
});

import { heicDimensions, heicToJpeg, MAX_PIXELS } from './heicToJpeg';

// fake-note.heic is a made-up 240x120 image (a red square and the word FAKE),
// encoded as HEVC HEIC by macOS `sips`, the same codec an iPhone uses. No real
// photo or lead is in it.
const FAKE_HEIC = new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'fake-note.heic')));

/** A header-only HEIC: ftyp + a meta box declaring the given size. No pixels. */
function fakeHeader(width: number, height: number): Uint8Array {
  const box = (type: string, body: number[]) => {
    const size = 8 + body.length;
    return [size >>> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...Buffer.from(type), ...body];
  };
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ftyp = box('ftyp', [...Buffer.from('heic'), ...u32(0), ...Buffer.from('mif1heic')]);
  const ispe = box('ispe', [...u32(0), ...u32(width), ...u32(height)]);
  const meta = box('meta', [...u32(0), ...box('iprp', box('ipco', ispe))]);
  return new Uint8Array([...ftyp, ...meta]);
}

beforeEach(() => {
  h.spawned = 0;
  h.active = 0;
  h.maxActive = 0;
});

describe('heicDimensions', () => {
  it('reads the size from the header without decoding', () => {
    expect(heicDimensions(FAKE_HEIC)).toEqual({ width: 240, height: 120 });
    expect(heicDimensions(fakeHeader(5712, 4284))).toEqual({ width: 5712, height: 4284 });
  });

  it('is null when there is no meta box or no ispe', () => {
    expect(heicDimensions(new Uint8Array(64))).toBeNull();
    expect(heicDimensions(FAKE_HEIC.slice(0, 30))).toBeNull();
  });
});

describe('heicToJpeg', () => {
  it('the fixture is a real HEIC that sharp alone cannot decode', async () => {
    expect(sniffImageKind(FAKE_HEIC)).toBe('heic');
    await expect(sharp(FAKE_HEIC).jpeg().toBuffer()).rejects.toThrow();
  });

  it('converts a HEIC to a JPEG of the same size and content', async () => {
    const out = await heicToJpeg(FAKE_HEIC);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.mime).toBe('image/jpeg');
    expect(sniffImageKind(out.bytes)).toBe('jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([240, 120]);
    // The left half is the red square: the pixels survived the trip.
    const { data } = await sharp(out.bytes).extract({ left: 40, top: 40, width: 1, height: 1 }).raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(150);
    expect(data[1]).toBeLessThan(80);
    expect(data[2]).toBeLessThan(80);
  });

  it('refuses an oversized HEIC from its header alone: nothing is decoded', async () => {
    // A 48 MP iPhone photo, and a header claiming far more than any phone shoots.
    for (const [w, hgt] of [[8064, 6048], [9000, 9000], [20000, 100]]) {
      expect(await heicToJpeg(fakeHeader(w, hgt))).toEqual({ ok: false, reason: 'too-large', width: w, height: hgt });
    }
    expect(5712 * 4284).toBeLessThanOrEqual(MAX_PIXELS);
    expect(h.spawned).toBe(0);
  });

  it('refuses a HEIC whose header declares no size, without decoding', async () => {
    const out = await heicToJpeg(new Uint8Array(64));
    expect(out).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(h.spawned).toBe(0);
  });

  it('reports a failure instead of throwing on a HEIC that will not decode', async () => {
    const broken = new Uint8Array([...fakeHeader(240, 120), ...new Uint8Array(64)]);
    const out = await heicToJpeg(broken);
    expect(out).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('runs one conversion at a time', async () => {
    const results = await Promise.all([heicToJpeg(FAKE_HEIC), heicToJpeg(FAKE_HEIC), heicToJpeg(FAKE_HEIC)]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(h.spawned).toBe(3);
    expect(h.maxActive).toBe(1);
  });
});
