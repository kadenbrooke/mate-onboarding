// App-side Telnyx Messaging sender (Node/Web fetch). Mirrors the edge helper's
// best-effort contract: returns a result object, never throws, skips when unset.
export interface SendSmsResult { ok: boolean; status?: number; error?: string; skipped?: boolean }

export async function sendSms(to: string, text: string): Promise<SendSmsResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.MATE_TELNYX_NUMBER;
  if (!apiKey || !from) return { ok: false, skipped: true, error: 'TELNYX_API_KEY or MATE_TELNYX_NUMBER unset' };
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
  const payload: Record<string, unknown> = { from, to, text };
  if (profileId) payload.messaging_profile_id = profileId;
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
