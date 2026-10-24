import { z } from "zod";
import { DEMO_LIMIT, DEMO_WINDOW_SECONDS, demoRun } from "@/lib/demo";
import { EntryError, writeEntry } from "@/lib/entry-writer";
import type { SavedEntry } from "@/lib/entry-schema";
import { formatIst } from "@/lib/ledger";
import { OWNER_METRICS } from "@/lib/metrics";
import { hitRateLimit } from "@/lib/rate-limit";
import { DbError } from "@/lib/supabase";
import { fetchRuns, WandbError } from "@/lib/wandb";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

const DemoRequestSchema = z.object({
  notes: z.string().trim().min(10, "Say a bit more about the run first.").max(4000, "That's a lot; keep it under a minute of talking."),
});

/**
 * Public "Try it yourself": writes an entry for the demo run from a visitor's notes and returns
 * it without saving anything. Limited to DEMO_LIMIT requests per IP per DEMO_WINDOW_SECONDS.
 */
export async function POST(request: Request) {
  const body = DemoRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const message = z.flattenError(body.error).fieldErrors.notes?.[0] ?? "Type or say what happened first.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    // Counted before calling Gemini, so failed attempts still count and can't be used to burn quota.
    const limit = await hitRateLimit(request, "demo-entry", DEMO_LIMIT, DEMO_WINDOW_SECONDS);
    if (!limit.allowed) {
      return Response.json(
        {
          error: `You've used all ${DEMO_LIMIT} demo tries for now. They come back at ${formatIst(limit.resetAt.toISOString())} IST. Meanwhile, the journal below has the real entries.`,
          limited: true,
        },
        { status: 429 },
      );
    }

    const runs = await fetchRuns();
    const demo = demoRun(runs);
    if (!demo) return Response.json({ error: "There are no runs to demo yet." }, { status: 404 });

    const entry = await writeEntry(runs, demo.run.id, body.data.notes, { metrics: OWNER_METRICS, geminiKey: null });
    const now = new Date().toISOString();
    const result: SavedEntry = {
      id: "demo",
      run_id: demo.run.id,
      raw_notes: body.data.notes,
      entry,
      created_at: now,
      created_label: formatIst(now),
      updated_label: null,
      fix_count: 0,
    };
    return Response.json({ entry: result, triesLeft: Math.max(0, DEMO_LIMIT - limit.hits) });
  } catch (err) {
    if (err instanceof WandbError || err instanceof EntryError || err instanceof DbError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Couldn't write the demo entry. Try again." }, { status: 500 });
  }
}
