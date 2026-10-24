import { connection } from "next/server";
import { errorResponse, NO_STORE, resolveContext } from "@/lib/context";
import { fetchRuns } from "@/lib/wandb";

export async function GET(request: Request) {
  await connection(); // always fetch live runs; never prerender at build time
  const resolved = await resolveContext(request, { write: false });
  if ("response" in resolved) return resolved.response;
  const { ctx } = resolved;
  try {
    const runs = await fetchRuns(ctx.source);
    return Response.json({ runs }, { headers: ctx.visitor ? NO_STORE : undefined });
  } catch (err) {
    return errorResponse(err, ctx, "Couldn't load runs from W&B.");
  }
}
