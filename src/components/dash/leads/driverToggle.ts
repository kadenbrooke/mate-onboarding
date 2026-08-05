// Driver (handler) toggle logic for the leads table, kept free of React so the
// optimistic-update + revert-on-error behaviour is unit-testable in isolation.
// The PATCH request shape mirrors LeadThread.tsx's "Take over" / "Hand back"
// control exactly: PATCH /api/leads/[id]/handler { session_id, handler }.

export type HandlerState = 'agent' | 'human';

/** Normalize a raw DB value (which may be null on legacy/demo rows) to a display
 *  state. Absent handler means the agent is driving by default. */
export function normalizeHandler(h: string | null | undefined): HandlerState {
  return h === 'human' ? 'human' : 'agent';
}

/** Flip agent <-> human. */
export function nextHandler(h: HandlerState): HandlerState {
  return h === 'agent' ? 'human' : 'agent';
}

/** Optimistically flip the driver, PATCH the handler endpoint, and revert if the
 *  request fails (bad status OR network throw) so the UI never silently lies.
 *
 *  `apply` is the caller's local-state setter: it is called once forward with the
 *  target state, and again with the original state on failure. `onError` surfaces
 *  a human-readable message for the caller to render as an error affordance.
 *  Returns the settled state and whether it committed. */
export async function toggleHandler(opts: {
  leadId: string;
  sessionId: string;
  current: HandlerState;
  apply: (h: HandlerState) => void;
  onError?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; handler: HandlerState; error?: string }> {
  const { leadId, sessionId, current, apply, onError } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const target = nextHandler(current);

  apply(target); // optimistic

  try {
    const res = await doFetch(`/api/leads/${leadId}/handler`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, handler: target }),
    });
    if (!res.ok) {
      apply(current); // revert
      const msg = `Couldn't update — try again`;
      onError?.(msg);
      return { ok: false, handler: current, error: msg };
    }
    return { ok: true, handler: target };
  } catch {
    apply(current); // revert on network error
    const msg = `Couldn't update — check connection`;
    onError?.(msg);
    return { ok: false, handler: current, error: msg };
  }
}
