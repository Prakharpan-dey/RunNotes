import type { Run, Scalar } from "@/lib/wandb";
import { improved, type MetricSet, type MetricSpec } from "@/lib/metrics";

export type MetricCell = {
  value: number | null;
  /** Change against the most recent earlier run that logged this metric. */
  delta: number | null;
  /** true = improved, false = got worse, null = no change or nothing to compare. */
  improved: boolean | null;
};

export type LedgerRow = {
  id: string;
  /** Position in run order, oldest = 1. Matches "Run 1, Run 2" in spoken notes. */
  n: number;
  name: string;
  state: string;
  started: string;
  url: string;
  primary: MetricCell;
  secondary: MetricCell | null;
  isBest: boolean;
  /** The best main-metric score among earlier runs, to compare against. Null for the first scored run. */
  bestBefore: { n: number; value: number } | null;
  /** Config of the run before this one, for showing what changed. Null for the first run. */
  prevConfig: Record<string, unknown> | null;
  config: Record<string, unknown>;
  summary: Record<string, Scalar>;
};

const startedFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatIst(iso: string): string {
  return startedFormat.format(new Date(iso));
}

export function num(value: Scalar | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Turns W&B runs (any order) into ledger rows, newest first. */
export function buildLedger(runs: Run[], metrics: MetricSet): LedgerRow[] {
  const oldestFirst = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last: Record<string, number | null> = {};

  const cell = (run: Run, spec: MetricSpec): MetricCell => {
    const value = num(run.summary[spec.key]);
    const prev = last[spec.key] ?? null;
    if (value === null) return { value, delta: null, improved: null };
    last[spec.key] = value;
    if (prev === null) return { value, delta: null, improved: null };
    const delta = value - prev;
    return { value, delta, improved: improved(spec, delta) };
  };

  const better = (a: number, b: number) => (metrics.primary.higherIsBetter ? a > b : a < b);
  let bestSoFar: { n: number; value: number } | null = null;
  const rows = oldestFirst.map((run, i): LedgerRow => {
    const bestBefore = bestSoFar;
    const v = num(run.summary[metrics.primary.key]);
    if (v !== null && (!bestSoFar || better(v, bestSoFar.value))) bestSoFar = { n: i + 1, value: v };
    return {
    id: run.id,
    n: i + 1,
    name: run.name,
    state: run.state,
    started: formatIst(run.createdAt),
    url: run.url,
    primary: cell(run, metrics.primary),
    secondary: metrics.secondary ? cell(run, metrics.secondary) : null,
    isBest: false,
    bestBefore,
    prevConfig: i > 0 ? oldestFirst[i - 1].config : null,
    config: run.config,
    summary: run.summary,
    };
  });

  const best = rows
    .filter((r) => r.primary.value !== null)
    .reduce<LedgerRow | null>((a, r) => (!a || better(r.primary.value!, a.primary.value!) ? r : a), null);
  if (best) best.isBest = true;

  return rows.reverse();
}
