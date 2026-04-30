import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return new NextResponse("Server misconfigured", { status: 500 });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(auth.slice("Basic ".length));
  const [, password] = decoded.split(":");
  if (password !== expected) return unauthorized();

  return NextResponse.next();
}
