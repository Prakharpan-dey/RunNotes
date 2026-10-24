import "server-only";
import { createHash } from "crypto";
import { db, DbError } from "@/lib/supabase";

export type RateLimitResult = { allowed: boolean; hits: number; resetAt: Date };

/** The caller's IP, as Vercel and most proxies report it. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** IPs are hashed before they're stored. */
function hashIp(ip: string): string {
  return createHash("sha256").update(`runnotes:${ip}`).digest("hex");
}

/** Counts one hit for this IP in `bucket` and says whether it's within `limit` per `windowSeconds`. */
export async function hitRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await db().rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_key: hashIp(clientIp(request)),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    throw new DbError(
      /hit_rate_limit|rate_limits/i.test(error.message)
        ? "The rate_limits table isn't set up yet. Run supabase/004_rate_limits.sql in the Supabase SQL editor."
        : `Supabase error: ${error.message}`,
    );
  }
  const row = (data as { allowed: boolean; hits: number; reset_at: string }[])[0];
  return { allowed: row.allowed, hits: row.hits, resetAt: new Date(row.reset_at) };
}
