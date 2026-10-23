import { connection } from "next/server";
import { fetchRuns, WandbError } from "@/lib/wandb";

export async function GET() {
  await connection(); // always fetch live runs; never prerender at build time
  try {
    const runs = await fetchRuns();
    return Response.json({ runs });
  } catch (err) {
    if (err instanceof WandbError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Couldn't load runs from W&B." }, { status: 500 });
  }
}
