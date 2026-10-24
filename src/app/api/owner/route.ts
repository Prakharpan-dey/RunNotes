import { cookies } from "next/headers";
import { checkPasscode, makeOwnerCookie, OWNER_COOKIE, ownerConfigured } from "@/lib/owner";
import { hitRateLimit } from "@/lib/rate-limit";
import { DbError } from "@/lib/supabase";

/** Unlock owner mode. Body: { passcode }. Limited to 10 tries per IP per 15 minutes. */
export async function POST(request: Request) {
  if (!ownerConfigured()) {
    return Response.json({ error: "Owner mode isn't set up. Add OWNER_PASSCODE to the environment." }, { status: 503 });
  }
  try {
    const limit = await hitRateLimit(request, "owner-login", 10, 15 * 60);
    if (!limit.allowed) {
      return Response.json({ error: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof DbError ? err.message : "Couldn't check the passcode." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { passcode?: unknown };
  if (typeof body.passcode !== "string" || !checkPasscode(body.passcode)) {
    return Response.json({ error: "That passcode isn't right." }, { status: 401 });
  }

  const { value, maxAge } = makeOwnerCookie();
  (await cookies()).set(OWNER_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return Response.json({ ok: true });
}

/** Leave owner mode. */
export async function DELETE() {
  (await cookies()).delete(OWNER_COOKIE);
  return Response.json({ ok: true });
}
