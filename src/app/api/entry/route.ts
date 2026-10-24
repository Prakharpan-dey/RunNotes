import { after } from "next/server";
import { z } from "zod";
import { chargeWorkspace, errorResponse, NO_STORE, resolveContext, secretsOf } from "@/lib/context";
import { EntryRequestSchema } from "@/lib/entry-schema";
import { writeEntry } from "@/lib/entry-writer";
import { redact } from "@/lib/errors";
import { regenerateInsights } from "@/lib/insights";
import { saveEntry } from "@/lib/supabase";
import { fetchRuns } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

export async function POST(request: Request) {
  const resolved = await resolveContext(request, { write: true });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;

  const body = EntryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const message = z.flattenError(body.error).fieldErrors.notes?.[0] ?? "Send a runId and your notes.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    await chargeWorkspace(request, ctx, { ai: true, write: true });
    // Run data always comes from W&B on the server, never from the browser.
    const runs = await fetchRuns(ctx.source);
    const entry = await writeEntry(runs, body.data.runId, body.data.notes, { metrics: ctx.metrics, geminiKey: ctx.geminiKey });
    const saved = await saveEntry(ctx.workspace, body.data.runId, body.data.notes, entry);
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
    return errorResponse(err, ctx, "Couldn't write the entry. Try again.");
  }
}
