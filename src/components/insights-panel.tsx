"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Prediction checks shown before "Show more". */
const VISIBLE_PREDICTIONS = 2;
import type { Comparison, InsightType, MetricKey, PredictionResult, RunFact, SavedInsights } from "@/lib/insights-schema";

const TYPE_LABEL: Record<InsightType, string> = {
  lever: "Lever",
  no_effect: "No effect",
  regression: "Regression",
  prediction_check: "Prediction check",
};

const TYPE_STYLE: Record<InsightType, string> = {
  lever: "border-ballpoint text-ballpoint",
  no_effect: "border-pencil/60 text-pencil",
  regression: "border-correction text-correction",
  prediction_check: "border-ochre text-ochre",
};

export type InsightsStatus =
  | { kind: "idle" }
  | { kind: "updating"; afterRun: number | null }
  | { kind: "error"; message: string };

function RunLink({ n, onGo }: { n: number; onGo: (n: number) => void }) {
  return (
    <a
      href={`#run-${n}`}
      onClick={(e) => {
        e.preventDefault();
        onGo(n);
      }}
      className="rounded-sm font-mono text-[12px] text-ballpoint underline decoration-ballpoint/40 underline-offset-[3px] hover:decoration-ballpoint"
    >
      run {n}
    </a>
  );
}

function metricValue(f: RunFact, metric: MetricKey): number | null {
  return metric === "val_pearson" ? f.pearson : f.rmse;
}

function Fact({ fact, metric, onGo }: { fact: RunFact; metric: MetricKey; onGo: (n: number) => void }) {
  const value = metricValue(fact, metric);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <RunLink n={fact.n} onGo={onGo} />
      <span className="font-mono text-[12px] tabular-nums">{value === null ? "—" : value.toFixed(3)}</span>
    </span>
  );
}

const METRIC_NAME: Record<MetricKey, string> = { val_rmse: "RMSE", val_pearson: "Pearson" };

/** Predicted vs actual on the predicted metric; every number and the colour come from code. */
function PredictionLine({ p, onGo }: { p: PredictionResult; onGo: (n: number) => void }) {
  return (
    <p className="mt-1 text-[13px] leading-relaxed text-pencil">
      <span className="font-hand text-[16px] text-graphite">“{p.quote}”</span>{" "}
      {/* Wraps between phrases on a phone; each number stays with its label. */}
      {p.comparison === "beat_run" && p.target_run ? (
        <span className="whitespace-nowrap">
          Predicted {METRIC_NAME[p.metric]} to beat <RunLink n={p.target_run} onGo={onGo} />{" "}
          <span className="font-mono text-[12px] text-graphite">{p.predicted.toFixed(3)}</span>;
        </span>
      ) : (
        <span className="whitespace-nowrap">
          Predicted {METRIC_NAME[p.metric]} {p.comparison}{" "}
          <span className="font-mono text-[12px] text-graphite">{p.predicted}</span>;
        </span>
      )}{" "}
      <span className="whitespace-nowrap">
        actual on <RunLink n={p.tested_run} onGo={onGo} />{" "}
        <span className="font-mono text-[12px] text-graphite">{p.actual.toFixed(3)}</span>
      </span>{" "}
      <span
        className={cn(
          "font-mono text-[11px] whitespace-nowrap tabular-nums",
          p.better === true ? "text-ballpoint" : p.better === false ? "text-correction" : "text-pencil",
        )}
        title={p.better ? `Better than predicted (${p.metric === "val_rmse" ? "lower" : "higher"} is better)` : "Worse than predicted"}
      >
        {p.delta > 0 ? "+" : p.delta < 0 ? "−" : "±"}
        {Math.abs(p.delta).toFixed(3)} vs prediction
      </span>
    </p>
  );
}

function ComparisonChip({ c }: { c: Comparison }) {
  // Saved before `improved` existed: those were all val_rmse, where lower is better.
  const improved = c.improved !== undefined ? c.improved : c.delta === 0 ? null : c.delta < 0;
  return (
    <span className="font-mono text-[11px] whitespace-nowrap text-pencil tabular-nums">
      {c.from} → {c.to}{" "}
      <span className={cn(improved === true ? "text-ballpoint" : improved === false ? "text-correction" : "text-pencil")}>
        {c.delta > 0 ? "+" : c.delta < 0 ? "−" : "±"}
        {Math.abs(c.delta).toFixed(3)}
      </span>
    </span>
  );
}

export function InsightsPanel({
  saved,
  status,
  entryCount,
  loadError,
  onRegenerate,
  onGoToRun,
  canWrite,
}: {
  saved: SavedInsights | null;
  status: InsightsStatus;
  entryCount: number;
  loadError: string | null;
  onRegenerate: () => void;
  onGoToRun: (n: number) => void;
  /** Owner mode: show Regenerate. */
  canWrite: boolean;
}) {
  const updating = status.kind === "updating";
  const body = saved?.insights;
  const stale = canWrite && !!saved && !updating && saved.entry_count < entryCount;

  // Keep the panel to about one screen: every lever, regression and no-effect, but only the
  // newest prediction checks (they arrive newest first). The rest sit behind "Show more".
  const [showAll, setShowAll] = useState(false);
  const all = body?.insights ?? [];
  let predictionsShown = 0;
  const collapsed = all.filter((x) => x.type !== "prediction_check" || predictionsShown++ < VISIBLE_PREDICTIONS);
  const hiddenCount = all.length - collapsed.length;
  const visible = showAll ? all : collapsed;

  return (
    <section aria-labelledby="insights-heading" aria-busy={updating} className="border-b-2 border-graphite/80 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="insights-heading" className="font-display text-xs font-bold tracking-[0.14em] text-pencil uppercase">
          What the runs say
        </h2>
        <p className="flex items-center gap-3 font-mono text-[11px] text-pencil" aria-live="polite">
          {updating ? (
            <span className="inline-flex items-center gap-1.5 text-ballpoint">
              <span className="size-1.5 rounded-full bg-ballpoint motion-safe:animate-pulse" aria-hidden />
              Updating{status.afterRun ? ` after run ${status.afterRun}` : ""}…
            </span>
          ) : saved ? (
            <span>
              updated after run {saved.after_run ?? "?"} · {saved.created_label}
            </span>
          ) : null}
          {canWrite && !updating && entryCount > 0 && !loadError && (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-sm font-sans text-[12px] text-ballpoint underline underline-offset-4"
            >
              {saved ? "Regenerate" : "Build insights"}
            </button>
          )}
        </p>
      </div>

      {loadError ? (
        <p className="mt-3 text-sm text-ochre">{loadError}</p>
      ) : !body ? (
        <p className="mt-3 max-w-prose font-hand text-xl text-pencil">
          {updating
            ? "Reading your runs…"
            : !canWrite
              ? "No insights yet."
              : entryCount === 0
                ? "Write your first entry and what you’re learning shows up here."
                : "Your entries are ready. Build insights to see what they add up to."}
        </p>
      ) : (
        <div className={cn("transition-opacity", updating && "opacity-55")}>
          <p className="mt-2 max-w-4xl font-display text-3xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[2.6rem]">
            {body.headline}
          </p>

          {stale && (
            <p className="mt-2 text-[12px] text-ochre">
              Built from {saved.entry_count} {saved.entry_count === 1 ? "entry" : "entries"}; you now have {entryCount}.
              Regenerate to include the rest.
            </p>
          )}

          {visible.length > 0 && (
            <ul
              id="insights-list"
              className="mt-5 divide-y divide-dashed divide-graphite/25 border-y border-dashed border-graphite/25"
            >
              {visible.map((x, i) => {
                const actual = x.facts.at(-1);
                // Older saved insights have no metric field; they were all val_rmse.
                const metric: MetricKey = x.metric ?? x.comparison?.metric ?? "val_rmse";
                return (
                  <li key={i} className="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                    <span
                      className={cn(
                        "h-fit w-fit rounded-sm border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide uppercase",
                        TYPE_STYLE[x.type],
                      )}
                    >
                      {TYPE_LABEL[x.type]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] leading-snug">{x.text}</p>
                      {x.prediction ? (
                        <PredictionLine p={x.prediction} onGo={onGoToRun} />
                      ) : x.type === "prediction_check" && x.predicted && actual && (
                        <p className="mt-1 text-[13px] text-pencil">
                          You predicted <span className="font-hand text-[16px] text-graphite">“{x.predicted}”</span>; W&B
                          logged{" "}
                          <span className="font-mono text-[12px] text-graphite">
                            {metricValue(actual, metric)?.toFixed(3) ?? "—"}
                          </span>{" "}
                          {metric} on run {actual.n}.
                        </p>
                      )}
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {x.comparison && x.type !== "prediction_check" && (
                          <span className="text-[11px] text-pencil">
                            {x.type === "lever" ? "previous best → new best" : "best so far → this run"}
                          </span>
                        )}
                        {x.facts.map((f) => (
                          <Fact key={f.n} fact={f} metric={metric} onGo={onGoToRun} />
                        ))}
                        {x.comparison && <ComparisonChip c={x.comparison} />}
                        {x.recovery && (
                          <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                            <span className="text-[11px] text-pencil">recovered</span>
                            <ComparisonChip c={x.recovery} />
                          </span>
                        )}
                        <span className="text-[11px] text-pencil">{metric} from W&B</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              aria-controls="insights-list"
              className="mt-2 rounded-sm text-[13px] text-ballpoint underline underline-offset-4"
            >
              {showAll
                ? "Show fewer"
                : `Show ${hiddenCount} more prediction ${hiddenCount === 1 ? "check" : "checks"}`}
            </button>
          )}

          <div className="mt-4 grid gap-x-4 gap-y-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <p className="font-display text-sm font-bold tracking-wide text-graphite uppercase">Try next →</p>
            <div className="min-w-0">
              <p className="text-[15px] leading-snug font-medium">{body.next_experiment.text}</p>
              {body.next_experiment.why && <p className="mt-0.5 text-[13px] text-pencil">{body.next_experiment.why}</p>}
            </div>
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="mt-3 text-sm text-correction">
          {status.message}
        </p>
      )}
    </section>
  );
}
