import { connection } from "next/server";
import { EntryError } from "@/lib/entry-writer";
import { getLatestInsights, regenerateInsights } from "@/lib/insights";
import { requireOwner } from "@/lib/owner";
import { DbError } from "@/lib/supabase";
import { WandbError } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

function fail(err: unknown) {
  if (err instanceof WandbError || err instanceof EntryError || err instanceof DbError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Couldn't build insights. Try again." }, { status: 500 });
}

/** The newest saved insights; the page polls this after an entry is written or fixed. */
export async function GET() {
  await connection();
  try {
    return Response.json({ insights: await getLatestInsights() });
  } catch (err) {
    return fail(err);
  }
}

/** Rebuilds insights now. Body: { triggerRunId?: string }. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { triggerRunId?: unknown };
  const triggerRunId = typeof body.triggerRunId === "string" ? body.triggerRunId : undefined;
  try {
    return Response.json({ insights: await regenerateInsights(triggerRunId) });
  } catch (err) {
    return fail(err);
  }
}
