import { NextResponse } from 'next/server';

// The origin every redirect (and every absolute link a route hands back) points at.
//
// NEXT_PUBLIC_MATE_URL wins when it is set. Never Host or X-Forwarded-*: any
// client can send those, so trusting them would turn the sign-in, sign-out,
// QuickBooks and Google routes into an open redirect. Self-hosted `next start`
// (KVM2) builds request.url from its own listen address (localhost:3000), so
// request.url is no answer there either.
//
// Without NEXT_PUBLIC_MATE_URL:
//   - on Vercel (VERCEL=1) request.url is the deployment's own domain, so it is
//     used as before. This keeps preview deploys signing in on their own URL.
//   - anywhere else in production the origin is null and the redirect fails
//     closed (a 500 with no Location).
//   - in development and tests request.url is used, so local runs keep working.
//
// NEXT_PUBLIC_* is inlined at build time, so the KVM2 image is built with it
// (deploy/kvm2/docker-compose.yml).
export function publicOrigin(request: Request): string | null {
  const production = process.env.NODE_ENV === 'production';
  const configured = process.env.NEXT_PUBLIC_MATE_URL?.trim();
  if (configured) {
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      return null;
    }
    if (url.protocol === 'https:' || (!production && url.protocol === 'http:')) return url.origin;
    return null;
  }
  if (!production || process.env.VERCEL === '1') return new URL(request.url).origin;
  return null;
}

// A same-site path: one leading "/", then not a second "/" or "\" (the URL parser
// reads "//x" and "/\x" as the host x), and no control characters (it drops tab,
// CR and LF, so "/\t/x" becomes "//x").
const RELATIVE_PATH = /^\/(?![/\\])[^\p{Cc}]*$/u;

/** `path` on the public origin, or null when there is no origin or `path` is not a same-site path. */
export function publicUrl(path: string, request: Request): URL | null {
  const origin = publicOrigin(request);
  if (!origin || !RELATIVE_PATH.test(path)) return null;
  const target = new URL(path, origin);
  return target.origin === origin ? target : null;
}

/**
 * A redirect to `path` on the public origin. A 500 with no Location when the
 * origin is not configured, or when `path` is not a same-site path (an absolute
 * URL, "//host", "/\host", no leading "/").
 */
export function publicRedirect(path: string, request: Request, status?: number): NextResponse {
  const target = publicUrl(path, request);
  if (!target) return new NextResponse('Redirect target is not configured', { status: 500 });
  return NextResponse.redirect(target, status);
}
