import { errorResponse, NO_STORE, visitorCredentials, type JournalContext } from "@/lib/context";
import { checkGeminiKey } from "@/lib/llm";
import { OWNER_METRICS } from "@/lib/metrics";
import { hitRateLimit } from "@/lib/rate-limit";
import { inspectProject } from "@/lib/wandb";

export const maxDuration = 60;

/**
 * Connect page, step 1: checks the visitor's W&B key and project (and their Gemini key, if
 * they added one) and lists the numeric metrics their runs log. Nothing is stored.
 */
export async function POST(request: Request) {
  const creds = visitorCredentials(request);
  if (!creds.ok) return Response.json({ error: creds.error }, { status: 400, headers: NO_STORE });
  // Only used to redact keys from any error message.
  const ctx: JournalContext = {
    workspace: "",
    visitor: true,
    source: creds.source,
    metrics: OWNER_METRICS,
    geminiKey: creds.geminiKey,
  };

  try {
    const limit = await hitRateLimit(request, "workspace-verify", 10, 60 * 60);
    if (!limit.allowed) {
      return Response.json({ error: "Too many connection checks. Wait an hour and try again." }, { status: 429, headers: NO_STORE });
    }
    const project = await inspectProject(creds.source);
    if (project.runCount === 0) {
      return Response.json(
        { error: `${creds.source.entity}/${creds.source.project} has no runs yet. Log a run to W&B first.` },
        { status: 400, headers: NO_STORE },
      );
    }
    if (project.metricKeys.length === 0) {
      return Response.json(
        { error: "None of these runs log a numeric summary metric, so there's nothing to compare yet." },
        { status: 400, headers: NO_STORE },
      );
    }
    if (creds.geminiKey) await checkGeminiKey(creds.geminiKey);
    return Response.json({ ...project, ownGeminiKey: !!creds.geminiKey }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't check the connection. Try again.");
  }
}
