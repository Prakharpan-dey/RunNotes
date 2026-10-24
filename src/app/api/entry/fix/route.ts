import { after } from "next/server";
import { regenerateInsights } from "@/lib/insights";
import { z } from "zod";
import { FixRequestSchema } from "@/lib/entry-schema";
import { EntryError, fixEntry } from "@/lib/entry-writer";
import { requireOwner } from "@/lib/owner";
import { applyFix, DbError, getEntryRow } from "@/lib/supabase";
import { fetchRuns } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = FixRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const message = z.flattenError(body.error).fieldErrors.correction?.[0] ?? "Send a runId and your correction.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    // The current entry comes from the database, not the browser, so a stale tab can't overwrite a newer fix.
    const row = await getEntryRow(body.data.runId);
    if (!row) return Response.json({ error: "This run has no entry yet. Write one first." }, { status: 404 });
    if (!("history" in row)) throw new DbError("The entries table is missing the history column. Run supabase/002_entry_history.sql in the Supabase SQL editor.");

    // The logged config keeps W&B the source of truth if the correction disagrees with it.
    // If W&B is down, the fix still goes through without it.
    const loggedConfig = await fetchRuns()
      .then((runs) => runs.find((r) => r.id === row.run_id)?.config ?? null)
      .catch(() => null);
    const fixed = await fixEntry(row.entry, row.raw_notes, body.data.correction, loggedConfig);
    const saved = await applyFix(row, fixed.notes, fixed.entry, body.data.correction);
    // Rebuild cross-run insights once the response is out; the page polls for the new version.
    after(() => regenerateInsights(body.data.runId).catch((err) => console.error("Insights regeneration failed:", err)));
    return Response.json({ entry: saved });
  } catch (err) {
    if (err instanceof EntryError || err instanceof DbError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Couldn't apply the fix. Try again." }, { status: 500 });
  }
}
