import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}

// Constant-time string compare. Length check leaks length (acceptable for HTTP
// Basic Auth where the expected password is fixed) but the per-byte XOR loop
// runs in time independent of where bytes diverge.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return new NextResponse("Server misconfigured", { status: 500 });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(auth.slice("Basic ".length));
  } catch {
    return unauthorized();
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return unauthorized();
  const password = decoded.slice(colon + 1);
  if (!timingSafeEqual(password, expected)) return unauthorized();

  return NextResponse.next();
}
