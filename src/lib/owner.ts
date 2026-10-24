import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * Owner mode: one passcode from OWNER_PASSCODE, no accounts. Logging in sets a signed,
 * httpOnly cookie; every write route checks it on the server. Changing the passcode
 * signs everyone out, because the passcode is also the signing key.
 */
export const OWNER_COOKIE = "rn_owner";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function passcode(): string | null {
  return process.env.OWNER_PASSCODE || null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", `runnotes-owner:${secret}`).update(payload).digest("base64url");
}

/** Constant-time string comparison that doesn't leak length. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function ownerConfigured(): boolean {
  return passcode() !== null;
}

export function checkPasscode(attempt: string): boolean {
  const secret = passcode();
  return secret !== null && safeEqual(attempt, secret);
}

/** Cookie value: "<expiry ms>.<signature>". */
export function makeOwnerCookie(): { value: string; maxAge: number } {
  const secret = passcode()!;
  const expires = String(Date.now() + MAX_AGE_S * 1000);
  return { value: `${expires}.${sign(expires, secret)}`, maxAge: MAX_AGE_S };
}

export async function isOwner(): Promise<boolean> {
  const secret = passcode();
  if (!secret) return false;
  const value = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return safeEqual(signature, sign(expires, secret));
}

/** For write routes: a 401 response if the caller isn't the owner, otherwise null. */
export async function requireOwner(): Promise<Response | null> {
  if (await isOwner()) return null;
  return Response.json(
    { error: "This journal is read-only. Unlock owner mode from the footer to make changes." },
    { status: 401 },
  );
}
