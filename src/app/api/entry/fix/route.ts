import { after } from "next/server";
import { z } from "zod";
import { chargeWorkspace, errorResponse, NO_STORE, resolveContext, secretsOf } from "@/lib/context";
import { FixRequestSchema } from "@/lib/entry-schema";
import { fixEntry } from "@/lib/entry-writer";
import { redact } from "@/lib/errors";
import { regenerateInsights } from "@/lib/insights";
import { applyFix, DbError, getEntryRow } from "@/lib/supabase";
import { fetchRuns } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

export async function POST(request: Request) {
  const resolved = await resolveContext(request, { write: true });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;

  const body = FixRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const message = z.flattenError(body.error).fieldErrors.correction?.[0] ?? "Send a runId and your correction.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    // The current entry comes from the database, not the browser, so a stale tab can't overwrite a newer fix.
    const row = await getEntryRow(ctx.workspace, body.data.runId);
    if (!row) return Response.json({ error: "This run has no entry yet. Write one first." }, { status: 404 });
    if (!("history" in row)) {
      throw new DbError("The entries table is missing the history column. Run supabase/002_entry_history.sql in the Supabase SQL editor.");
    }
    await chargeWorkspace(request, ctx, { ai: true, write: true });

    // The logged config keeps W&B the source of truth if the correction disagrees with it.
    // If W&B is down, the fix still goes through without it.
    const loggedConfig = await fetchRuns(ctx.source)
      .then((runs) => runs.find((r) => r.id === row.run_id)?.config ?? null)
      .catch(() => null);
    const fixed = await fixEntry(row.entry, row.raw_notes, body.data.correction, loggedConfig, {
      metrics: ctx.metrics,
      geminiKey: ctx.geminiKey,
    });
    const saved = await applyFix(row, fixed.notes, fixed.entry, body.data.correction);
    // Rebuild cross-run insights once the response is out; the page polls for the new version.
    after(async () => {
      try {
        await chargeWorkspace(request, ctx, { ai: true, write: false });
        await regenerateInsights(ctx, body.data.runId);
      } catch (err) {
        console.error("Insights regeneration skipped:", redact(err instanceof Error ? err.message : String(err), secretsOf(ctx)));
      }
    });
    return Response.json({ entry: saved }, { headers: ctx.visitor ? NO_STORE : undefined });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't apply the fix. Try again.");
  }
}
