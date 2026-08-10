import { NextResponse, type NextRequest } from 'next/server';

// Access control for the whole app (Next 16 "proxy", formerly "middleware").
//
// FWAI Tracker has no user accounts — it was built for a trusted internal Ops
// team, and every one of its API routes was therefore reachable anonymously:
// reading every client, VM, credential label and alert, and also DELETE
// /api/clients/[id] (which cascades to that client's VMs, apps, webinars and
// OpenAI accounts) and POST /api/alerts { send_whatsapp: true } (which spends
// real AI Sensy quota messaging a real phone number).
//
// This puts HTTP Basic Auth in front of every page and every /api route when
// DASHBOARD_USER and DASHBOARD_PASSWORD are both set.
//
// WHY OPT-IN, AND WHAT TO PREFER INSTEAD
// --------------------------------------
// Unset, this middleware does nothing at all, so local development and any
// deployment that is already protected another way are completely unaffected.
// If your host provides its own protection, use that first — on Vercel it is
// Project -> Settings -> Deployment Protection -> Vercel Authentication, which
// authenticates against your Vercel team with no code and no shared password.
// This is the portable fallback for other hosts, and is harmless as a second
// layer underneath one.
//
// Basic Auth is only meaningful over HTTPS; the credential is base64, not
// encrypted. Every serious host terminates TLS for you.

const USER = process.env.DASHBOARD_USER;
const PASSWORD = process.env.DASHBOARD_PASSWORD;

/**
 * Paths that must stay reachable without Basic Auth.
 *
 * Vercel Cron cannot present a username and password, so gating the cron route
 * here would silently kill every scheduled health check, WhatsApp alert and
 * OpenAI credit sync in production. It is not left unprotected: it carries its
 * own bearer check against CRON_SECRET and refuses with 503 in production when
 * that secret is missing (see src/app/api/cron/check-all/route.ts).
 */
const EXEMPT = ['/api/cron/'];

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Deliberately dependency-free: middleware runs on the Edge runtime, where
 * node:crypto's timingSafeEqual is unavailable. Comparing every character
 * regardless of an early mismatch is what matters. The length is folded into the
 * result rather than short-circuited on, so only the length can be inferred.
 */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      // Prompts a browser for credentials; an API client sees a plain 401.
      'WWW-Authenticate': 'Basic realm="FWAI Tracker", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

// Named `proxy` because Next 16 renamed the middleware file convention; the file
// must be src/proxy.ts and export either a default function or one called proxy.
export function proxy(req: NextRequest) {
  // Not configured -> behave exactly as before.
  if (!USER || !PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (EXEMPT.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized(); // not valid base64
  }

  // Only the FIRST colon separates the two fields — a password may contain more.
  const sep = decoded.indexOf(':');
  if (sep < 0) return unauthorized();
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  // Both are always compared, so a correct username cannot be detected by the
  // request finishing sooner than a wrong one.
  const okUser = safeEqual(user, USER);
  const okPassword = safeEqual(password, PASSWORD);
  if (!okUser || !okPassword) return unauthorized();

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own build output and the favicon. API routes are
  // deliberately INCLUDED — they are the part that most needs protecting.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
