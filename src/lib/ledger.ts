import type { Run, Scalar } from "@/lib/wandb";

export type MetricSpec = {
  key: string;
  higherIsBetter: boolean;
};

export const RMSE: MetricSpec = { key: "val_rmse", higherIsBetter: false };
export const PEARSON: MetricSpec = { key: "val_pearson", higherIsBetter: true };

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
  rmse: MetricCell;
  pearson: MetricCell;
  isBest: boolean;
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
export function buildLedger(runs: Run[]): LedgerRow[] {
  const oldestFirst = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last: Record<string, number | null> = {};

  const cell = (run: Run, spec: MetricSpec): MetricCell => {
    const value = num(run.summary[spec.key]);
    const prev = last[spec.key] ?? null;
    if (value === null) return { value, delta: null, improved: null };
    last[spec.key] = value;
    if (prev === null) return { value, delta: null, improved: null };
    const delta = value - prev;
    const improved = delta === 0 ? null : spec.higherIsBetter ? delta > 0 : delta < 0;
    return { value, delta, improved };
  };

  const rows = oldestFirst.map((run, i): LedgerRow => ({
    id: run.id,
    n: i + 1,
    name: run.name,
    state: run.state,
    started: formatIst(run.createdAt),
    url: run.url,
    rmse: cell(run, RMSE),
    pearson: cell(run, PEARSON),
    isBest: false,
    config: run.config,
    summary: run.summary,
  }));

  const best = rows
    .filter((r) => r.rmse.value !== null)
    .reduce<LedgerRow | null>((a, r) => (!a || r.rmse.value! < a.rmse.value! ? r : a), null);
  if (best) best.isBest = true;

  return rows.reverse();
}
