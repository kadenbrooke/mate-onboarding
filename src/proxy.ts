import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_FILE = /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ico)$/;

// PWA install assets the browser fetches without a user session. The manifest is
// `.json` (not covered by PUBLIC_FILE) and would otherwise redirect to /login for
// anonymous visitors, breaking install metadata. Icons already pass via .png/.svg.
const PUBLIC_PWA = new Set(["/manifest.json", "/manifest.webmanifest"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_FILE.test(path) || PUBLIC_PWA.has(path)) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
