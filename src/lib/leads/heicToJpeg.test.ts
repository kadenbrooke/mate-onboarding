// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { heicToJpeg } from './heicToJpeg';
import { sniffImageKind } from './snapshotImage';

// fake-note.heic is a made-up 240x120 image (a red square and the word FAKE),
// encoded as HEVC HEIC by macOS `sips`, the same codec an iPhone uses. No real
// photo or lead is in it.
const FAKE_HEIC = new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'fake-note.heic')));

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

  it('reports a failure instead of throwing on bytes that are not a decodable HEIC', async () => {
    const broken = FAKE_HEIC.slice(0, 200);
    const out = await heicToJpeg(broken);
    expect(out.ok).toBe(false);
  });
});
