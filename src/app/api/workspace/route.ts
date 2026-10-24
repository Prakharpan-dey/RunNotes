import { z } from "zod";
import { errorResponse, NO_STORE, visitorCredentials, workspaceDbMessage, type JournalContext } from "@/lib/context";
import { OWNER_METRICS } from "@/lib/metrics";
import { hitRateLimit } from "@/lib/rate-limit";
import { db, DbError } from "@/lib/supabase";
import { inspectProject } from "@/lib/wandb";

export const maxDuration = 60;

const MetricChoice = z.object({ key: z.string().min(1).max(200), higherIsBetter: z.boolean() });
const SetupSchema = z.object({ primary: MetricChoice, secondary: MetricChoice.nullable() });

/**
 * Connect page, step 2: creates or updates the visitor's workspace with the metrics they
 * chose. Stores the W&B entity, project and metric names, never a key.
 */
export async function POST(request: Request) {
  const creds = visitorCredentials(request);
  if (!creds.ok) return Response.json({ error: creds.error }, { status: 400, headers: NO_STORE });
  if (!creds.workspace) return Response.json({ error: "Missing workspace ID." }, { status: 400, headers: NO_STORE });
  const ctx: JournalContext = { workspace: creds.workspace, visitor: true, source: creds.source, metrics: OWNER_METRICS, geminiKey: creds.geminiKey };

  const body = SetupSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Choose a main metric first." }, { status: 400, headers: NO_STORE });
  const { primary, secondary } = body.data;
  if (secondary && secondary.key === primary.key) {
    return Response.json({ error: "Pick a different second metric, or none." }, { status: 400, headers: NO_STORE });
  }

  try {
    const limit = await hitRateLimit(request, "workspace-setup", 20, 60 * 60);
    if (!limit.allowed) return Response.json({ error: "Too many changes. Wait an hour and try again." }, { status: 429, headers: NO_STORE });

    // The chosen metrics must exist in this project's runs.
    const { metricKeys } = await inspectProject(creds.source);
    for (const m of [primary, secondary]) {
      if (m && !metricKeys.includes(m.key)) {
        return Response.json({ error: `None of your runs log "${m.key}".` }, { status: 400, headers: NO_STORE });
      }
    }

    const { data: existing, error: readError } = await db()
      .from("workspaces")
      .select("wandb_entity, wandb_project")
      .eq("id", creds.workspace)
      .maybeSingle();
    if (readError) throw new DbError(workspaceDbMessage(readError.message));
    if (existing && (existing.wandb_entity !== creds.source.entity || existing.wandb_project !== creds.source.project)) {
      return Response.json({ error: "This workspace belongs to a different W&B project." }, { status: 409, headers: NO_STORE });
    }

    const { error } = await db().from("workspaces").upsert({
      id: creds.workspace,
      wandb_entity: creds.source.entity,
      wandb_project: creds.source.project,
      primary_metric: primary.key,
      primary_higher_is_better: primary.higherIsBetter,
      secondary_metric: secondary?.key ?? null,
      secondary_higher_is_better: secondary?.higherIsBetter ?? null,
      last_seen_at: new Date().toISOString(),
    });
    if (error) throw new DbError(workspaceDbMessage(error.message));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't save the workspace. Try again.");
  }
}
