import { after } from "next/server";
import { regenerateInsights } from "@/lib/insights";
import { z } from "zod";
import { EntryRequestSchema } from "@/lib/entry-schema";
import { EntryError, writeEntry } from "@/lib/entry-writer";
import { requireOwner } from "@/lib/owner";
import { DbError, saveEntry } from "@/lib/supabase";
import { fetchRuns, WandbError } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = EntryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const message = z.flattenError(body.error).fieldErrors.notes?.[0] ?? "Send a runId and your notes.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    // Run data always comes from W&B on the server, never from the browser.
    const runs = await fetchRuns();
    const entry = await writeEntry(runs, body.data.runId, body.data.notes);
    const saved = await saveEntry(body.data.runId, body.data.notes, entry);
    // Rebuild cross-run insights once the response is out; the page polls for the new version.
    after(() => regenerateInsights(body.data.runId).catch((err) => console.error("Insights regeneration failed:", err)));
    return Response.json({ entry: saved });
  } catch (err) {
    if (err instanceof WandbError || err instanceof EntryError || err instanceof DbError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Couldn't write the entry. Try again." }, { status: 500 });
  }
}
