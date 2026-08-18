import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientEventInsert } from '@/lib/metrics/eventSources';

/**
 * Write one derived ticker row, best effort.
 *
 * Two properties this helper exists to guarantee:
 *
 *  1. It NEVER throws and never rejects. The dashboard's activity feed is a
 *     mirror of work that already happened; a failure to mirror must not fail
 *     the postcall or signal request that did the actual work.
 *  2. It is idempotent. `source_key` carries a unique index (migration 0013)
 *     and the write is an ignore-on-conflict upsert, so a webhook retry, a
 *     re-run of the backfill, and a trigger firing twice on the same row all
 *     land exactly one ticker line.
 *
 * A null event (the mapper decided the source record describes no real agent
 * action) is a no-op, so callers can pass a mapper result straight through.
 */
export async function emitClientEvent(
  supabase: SupabaseClient,
  event: ClientEventInsert | null,
): Promise<{ emitted: boolean; error: string | null }> {
  if (!event) return { emitted: false, error: null };
  try {
    const { error } = await supabase
      .from('client_events')
      .upsert(event, { onConflict: 'source_key', ignoreDuplicates: true });
    if (error) {
      console.warn('client_events emit failed', event.source_key, error.message);
      return { emitted: false, error: error.message };
    }
    return { emitted: true, error: null };
  } catch (err) {
    // Network/transport failure. Same rule: the mirror never breaks the write.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('client_events emit threw', event.source_key, message);
    return { emitted: false, error: message };
  }
}
