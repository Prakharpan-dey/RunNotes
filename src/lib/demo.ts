import type { Run } from "@/lib/wandb";

/** The run judges try the dictation on: run 4, adding text features, the current best. */
export const DEMO_RUN_NUMBER = 4;

/** Requests per IP per window for the demo. */
export const DEMO_LIMIT = 5;
export const DEMO_WINDOW_SECONDS = 4 * 60 * 60;

/** Run DEMO_RUN_NUMBER in run order (oldest = 1), or the newest run if there aren't that many. */
export function demoRun(runs: Run[]): { run: Run; n: number } | null {
  const oldestFirst = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (oldestFirst.length === 0) return null;
  const i = Math.min(DEMO_RUN_NUMBER, oldestFirst.length) - 1;
  return { run: oldestFirst[i], n: i + 1 };
}
