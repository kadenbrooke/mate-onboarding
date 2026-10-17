export const MAX_REFERRAL_BODY_BYTES = 16 * 1024;

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too-large' | 'bad-json' };

/** Read a referral JSON body with a hard byte ceiling before JSON.parse. */
export async function readReferralJsonBody(
  request: Request,
  maxBytes = MAX_REFERRAL_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too-large' };

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: 'bad-json' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: 'too-large' };
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
}
