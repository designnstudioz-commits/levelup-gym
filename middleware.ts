import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect all /dashboard/* routes
  if (pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Phase 3: /pos and /api/pos sit outside /dashboard, so the guard above
  // does not cover them. Without this the touch terminal and every POS API
  // route would be reachable with no session at all.
  //
  // Only authentication is checked here. Role authorisation happens in the
  // page/route itself (see src/lib/pos/permissions.ts and
  // src/lib/pos/auth.ts) because the middleware would need a database
  // round-trip per request to resolve the caller's role, on every asset and
  // navigation. API routes return 401 rather than redirecting so the
  // terminal can surface a real error instead of parsing a login page.
  if (!user && (pathname === "/pos" || pathname.startsWith("/pos/"))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!user && pathname.startsWith("/api/pos")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Redirect logged-in users away from /login.
  //
  // Role-aware as of Phase 3: a cashier belongs at /pos and HealthBox staff
  // at their scoped landing page, not on the gym dashboard. The role lookup
  // is worth one query here because it runs only on the /login path, not on
  // every request.
  if (pathname === "/login" && user) {
    let destination = "/dashboard";
    if (user.email) {
      const { data: systemUser } = await supabase
        .from("system_users")
        .select("role")
        .eq("email", user.email.toLowerCase())
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();

      // landingRouteForRole is not imported here: middleware runs on the
      // edge runtime and this keeps the bundle free of app-layer imports.
      // The mapping is intentionally duplicated in exactly one other place
      // (src/lib/pos/permissions.ts) and both are two lines long.
      //
      // healthbox_staff -> /dashboard/pos/catalog/products: there is no
      // standalone HealthBox dashboard (yet) — /dashboard/pos/healthbox
      // 404s. Products is the existing, already-authorised, department-
      // scoped landing screen (POS_ROUTE_ROLES includes healthbox_staff;
      // the API strips cost/margin and filters to their own department),
      // so it's safe without building a new page just for this redirect.
      if (systemUser?.role === "cashier") destination = "/pos";
      else if (systemUser?.role === "healthbox_staff") destination = "/dashboard/pos/catalog/products";
    }
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|iclock|api/attendance|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
