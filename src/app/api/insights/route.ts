import { connection } from "next/server";
import { chargeWorkspace, errorResponse, NO_STORE, resolveContext } from "@/lib/context";
import { getLatestInsights, regenerateInsights } from "@/lib/insights";

// Allows for Gemini retries when it's overloaded.
export const maxDuration = 120;

/** The newest saved insights; the page polls this after an entry is written or fixed. */
export async function GET(request: Request) {
  await connection();
  const resolved = await resolveContext(request, { write: false });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;
  try {
    const insights = await getLatestInsights({ workspace: ctx.workspace, project: ctx.source.project });
    return Response.json({ insights }, { headers: ctx.visitor ? NO_STORE : undefined });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't load insights.");
  }
}

/** Rebuilds insights now. Body: { triggerRunId?: string }. */
export async function POST(request: Request) {
  const resolved = await resolveContext(request, { write: true });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;

  const body = (await request.json().catch(() => ({}))) as { triggerRunId?: unknown };
  const triggerRunId = typeof body.triggerRunId === "string" ? body.triggerRunId : undefined;
  try {
    await chargeWorkspace(request, ctx, { ai: true, write: true });
    const insights = await regenerateInsights(ctx, triggerRunId);
    return Response.json({ insights }, { headers: ctx.visitor ? NO_STORE : undefined });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't build insights. Try again.");
  }
}
