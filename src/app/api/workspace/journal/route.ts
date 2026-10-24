import { connection } from "next/server";
import { errorResponse, HEADER, NO_STORE, resolveContext, WORKSPACE_AI_LIMIT } from "@/lib/context";
import { getLatestInsights } from "@/lib/insights";
import { buildLedger } from "@/lib/ledger";
import { DbError, getEntries } from "@/lib/supabase";
import { fetchRuns } from "@/lib/wandb";

/** Everything the workspace page needs to render a visitor's journal. */
export async function GET(request: Request) {
  await connection();
  if (!request.headers.has(HEADER.workspace)) {
    return Response.json({ error: "Connect your W&B project first." }, { status: 400, headers: NO_STORE });
  }
  const resolved = await resolveContext(request, { write: false });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;

  try {
    const [runs, entries, insights] = await Promise.allSettled([
      fetchRuns(ctx.source),
      getEntries(ctx.workspace),
      getLatestInsights({ workspace: ctx.workspace, project: ctx.source.project }),
    ]);
    if (runs.status === "rejected") throw runs.reason;
    const dbNotice = (r: PromiseSettledResult<unknown>) =>
      r.status === "rejected" ? (r.reason instanceof DbError ? r.reason.message : "Couldn't load saved data.") : null;
    return Response.json(
      {
        entity: ctx.source.entity,
        project: ctx.source.project,
        metrics: ctx.metrics,
        rows: buildLedger(runs.value, ctx.metrics),
        entries: entries.status === "fulfilled" ? entries.value : {},
        insights: insights.status === "fulfilled" ? insights.value : null,
        notice: dbNotice(entries),
        insightsError: dbNotice(insights),
        ownGeminiKey: !!ctx.geminiKey,
        aiLimit: WORKSPACE_AI_LIMIT,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't load your journal.");
  }
}
