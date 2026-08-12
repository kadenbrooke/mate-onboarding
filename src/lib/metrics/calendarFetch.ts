// src/lib/metrics/calendarFetch.ts
//
// Server-only: pull a client's Google Calendar. Sibling of googleAdsFetch.ts --
// same split, network here and pure mapping in calendarSync.ts, so the mapping
// tests never touch a socket.
//
// Auth shape: the client consents once at /api/connect/google (scopes include
// calendar.readonly) and the refresh token lands in the server-only column
// onboarding_sessions.google_token_ref. Every pull exchanges that refresh token
// for a short-lived access token. The refresh token is NEVER logged, never put
// in a URL, and never returned to a caller.
//
// Env is read inside the functions, never at module scope, so `next build`
// succeeds without any Google credentials present.

import type { GoogleCalendarEvent } from './calendarSync';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// `primary` is the account's own default calendar -- the one a small business
// owner actually books into. No calendar-list discovery: pulling every calendar
// a client can see would drag in subscribed holiday/shared calendars as jobs.
const CALENDAR_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Google caps maxResults at 2500; 250/page keeps each response small.
const PAGE_SIZE = 250;
// A stop, not an expectation. 10 pages = 2500 events in a 120-day window; past
// that something is wrong and we would rather fail than loop forever.
const MAX_PAGES = 10;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

/**
 * Read the shared Google OAuth app credentials (the same pair that powers the
 * consent flow in /api/connect/google). Returns null when nothing is set, so a
 * sync run can report "not configured" instead of failing; a HALF-configured
 * env is a mistake rather than a state, so it throws.
 *
 * GOOGLE_OAUTH_REDIRECT_URI is deliberately not required here -- it matters to
 * the consent + code-exchange flow, not to a refresh-token exchange.
 */
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  const present = [clientId, clientSecret].filter(Boolean);
  if (present.length === 0) return null; // cleanly not set up yet
  if (present.length < 2) {
    throw new Error(
      'Google OAuth config is partially set. Need both GOOGLE_OAUTH_CLIENT_ID ' +
      'and GOOGLE_OAUTH_CLIENT_SECRET.',
    );
  }

  return { clientId: clientId!, clientSecret: clientSecret! };
}

/**
 * Exchange the client's long-lived refresh token for a short-lived access
 * token. The error message carries Google's `error` / `error_description` only
 * -- never the token, which must not reach a log or an HTTP response.
 */
export async function calendarAccessToken(
  refreshToken: string,
  cfg: GoogleOAuthConfig,
): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google OAuth token exchange failed (${res.status}): ` +
      `${json.error_description ?? json.error ?? 'unknown'}`,
    );
  }
  return json.access_token;
}

type EventsPage = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
};

/**
 * List events on the `primary` calendar across the window, following
 * pagination to the end.
 *
 * singleEvents=true expands recurring series into concrete instances, each with
 * its own stable id -- which is exactly what an appointment row needs. It also
 * means Google can hand back individually-cancelled instances with
 * status='cancelled'; mapEventsToRows turns those into deletions.
 *
 * Throws on any non-2xx (including the 403 a client who consented BEFORE the
 * calendar scope was added will produce) so the caller reports a real failure
 * instead of writing an empty calendar that reads as "all your jobs vanished".
 */
export async function fetchCalendarEvents(
  accessToken: string,
  window: { timeMin: string; timeMax: string },
): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(PAGE_SIZE),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Google Calendar API error (${res.status}): ${text.slice(0, 400)}`);
    }

    let parsed: EventsPage;
    try {
      parsed = JSON.parse(text) as EventsPage;
    } catch {
      throw new Error('Google Calendar API returned unparseable JSON');
    }

    events.push(...(parsed.items ?? []));
    pageToken = parsed.nextPageToken;
    if (!pageToken) return events;
  }

  throw new Error(`Google Calendar pagination exceeded ${MAX_PAGES} pages`);
}
