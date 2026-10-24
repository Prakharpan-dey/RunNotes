"use client";

import { createContext, Fragment, useContext, useState } from "react";
import { cn } from "@/lib/utils";
import type { Comparison, Insight, InsightType, MetricKey, PredictionResult, RunFact, SavedInsights } from "@/lib/insights-schema";
import { NOISE_REL, REGRESSION_REL, type MetricSet } from "@/lib/metrics";

/** Prediction checks shown before "Show more". */
const VISIBLE_PREDICTIONS = 2;

/** Margin notes, as you'd write them beside a result on the pad: short enough never to wrap. */
const TYPE_LABEL: Record<InsightType, string> = {
  lever: "New best",
  no_effect: "No effect",
  regression: "Setback",
  prediction_check: "Prediction",
};

const TYPE_HELP: Record<InsightType, string> = {
  lever: "A change that set a new best score.",
  no_effect: `A change that moved the score by less than the run-to-run noise (${NOISE_REL * 100}% of the best).`,
  regression: `A change that made the score clearly worse than the best so far (by more than ${REGRESSION_REL * 100}%).`,
  prediction_check: "Something you said you expected, checked against what W&B logged.",
};

const TYPE_INK: Record<InsightType, string> = {
  lever: "text-ballpoint",
  no_effect: "text-pencil",
  regression: "text-correction",
  prediction_check: "text-ochre",
};

export type InsightsStatus =
  | { kind: "idle" }
  | { kind: "updating"; afterRun: number | null }
  | { kind: "error"; message: string };

/** Where "run N" links point, so they also work opened in a new tab or without JavaScript. */
const RunHref = createContext<(n: number) => string>(() => "#");

function RunLink({ n, onGo }: { n: number; onGo: (n: number) => void }) {
  const href = useContext(RunHref)(n);
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onGo(n);
      }}
      className="tap rounded-sm font-medium whitespace-nowrap text-ballpoint underline decoration-ballpoint/35 underline-offset-2 hover:decoration-ballpoint"
    >
      run {n}
    </a>
  );
}

/** A run's value for a metric. Insights saved before metrics were configurable used rmse/pearson fields. */
function metricValue(f: RunFact, metric: MetricKey, set: MetricSet): number | null {
  if (metric === set.primary.key && f.primary !== undefined) return f.primary;
  if (metric === set.secondary?.key && f.secondary !== undefined) return f.secondary;
  if (metric === "val_rmse") return f.rmse ?? null;
  if (metric === "val_pearson") return f.pearson ?? null;
  return null;
}

function Signed({ delta, improved }: { delta: number; improved: boolean | null }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        improved === true ? "text-ballpoint" : improved === false ? "text-correction" : "text-pencil",
      )}
    >
      {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
      {Math.abs(delta).toFixed(3)}
      <span className="sr-only">{improved === true ? " (better)" : improved === false ? " (worse)" : ""}</span>
    </span>
  );
}

// Saved before `improved` existed: those were all val_rmse, where lower is better.
const improvedOf = (c: Comparison) => (c.improved !== undefined ? c.improved : c.delta === 0 ? null : c.delta < 0);

/** "run 4 0.672": one run, one value. */
function At({ n, value, onGo }: { n: number; value: number | null; onGo: (n: number) => void }) {
  return (
    <span className="whitespace-nowrap">
      <RunLink n={n} onGo={onGo} />{" "}
      <span className="font-mono text-graphite tabular-nums">{value === null ? "—" : value.toFixed(3)}</span>
    </span>
  );
}

/**
 * The runs behind a finding, chained the way you'd write them on the pad
 * ("run 1 0.702 → run 4 0.672 · −0.030 vs run 1"): each run once, the change once.
 */
function Trail({ x, metric, set, onGo }: { x: Insight; metric: MetricKey; set: MetricSet; onGo: (n: number) => void }) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-note text-pencil">
      {x.facts.map((f, i) => (
        <Fragment key={f.n}>
          {i > 0 && (
            <span>
              <span aria-hidden>→</span>
              <span className="sr-only">then</span>
            </span>
          )}
          <At n={f.n} value={metricValue(f, metric, set)} onGo={onGo} />
        </Fragment>
      ))}
      {x.comparison && (
        <span className="ml-1.5 whitespace-nowrap">
          <Signed delta={x.comparison.delta} improved={improvedOf(x.comparison)} /> vs run {x.comparison.from}
        </span>
      )}
      {x.recovery && (
        <span className="ml-1.5 whitespace-nowrap">
          then run {x.recovery.to} recovered to <Signed delta={x.recovery.delta} improved={improvedOf(x.recovery)} /> vs run{" "}
          {x.recovery.from}
        </span>
      )}
      {metric !== set.primary.key && <span className="ml-1.5">({metric})</span>}
    </p>
  );
}

/** The person's own words, then the result marked against them like a teacher's tick. */
function PredictionNote({ p, onGo }: { p: PredictionResult; onGo: (n: number) => void }) {
  const verdict = p.better === true ? "held" : p.better === false ? "missed" : "about right";
  return (
    <p className="mt-1.5 text-note leading-relaxed text-pencil">
      <span className="font-hand text-hand text-graphite">“{p.quote}”</span>{" "}
      <span className="whitespace-nowrap">
        <RunLink n={p.tested_run} onGo={onGo} /> came in at{" "}
        <span className="font-mono text-graphite tabular-nums">{p.actual.toFixed(3)}</span>
      </span>
      {", "}
      {p.comparison === "beat_run" && p.target_run ? (
        <span className="whitespace-nowrap">
          against <At n={p.target_run} value={p.predicted} onGo={onGo} />
        </span>
      ) : (
        <span className="whitespace-nowrap">
          predicted {p.comparison} <span className="font-mono text-graphite tabular-nums">{p.predicted}</span>
        </span>
      )}{" "}
      <span
        className={cn(
          "ml-1 font-hand text-hand whitespace-nowrap",
          p.better === true ? "text-ballpoint" : p.better === false ? "text-correction" : "text-pencil",
        )}
      >
        {verdict}
        {p.better !== null && ` by ${Math.abs(p.delta).toFixed(3)}`}
      </span>
    </p>
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
  metrics,
  runHref,
}: {
  /** The URL of a run's row, e.g. "#run-row-abc123". */
  runHref: (n: number) => string;
  saved: SavedInsights | null;
  /** The journal's metrics; saved insights carry their own, which win. */
  metrics: MetricSet;
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
  const set = body?.metrics ?? metrics;
  const stale = canWrite && !!saved && !updating && saved.entry_count < entryCount;

  // Keep the panel to about one screen: every lever, regression and no-effect, but only the
  // newest prediction checks (they arrive newest first). The rest sit behind "Show more".
  const [showAll, setShowAll] = useState(false);
  const recoveries = (body?.insights ?? []).flatMap((x) => (x.recovery ? [`${x.recovery.from}>${x.recovery.to}`] : []));
  const all = (body?.insights ?? []).filter(
    (x) => !(x.type === "no_effect" && x.comparison && recoveries.includes(`${x.comparison.from}>${x.comparison.to}`)),
  );
  let predictionsShown = 0;
  const collapsed = all.filter((x) => x.type !== "prediction_check" || predictionsShown++ < VISIBLE_PREDICTIONS);
  const hiddenCount = all.length - collapsed.length;
  const visible = showAll ? all : collapsed;

  return (
    <RunHref.Provider value={runHref}>
    <section aria-labelledby="insights-heading" aria-busy={updating} className="border-b-2 border-graphite/80 px-4 py-5 sm:px-6">
      {/* The headline is the section's heading; with no headline yet, the heading is for screen readers only. */}
      {!body && (
        <h3 id="insights-heading" className="sr-only">
          What the runs say
        </h3>
      )}
      <div className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">
        <p className="flex items-center gap-3 font-mono text-meta text-pencil" aria-live="polite">
          {updating ? (
            <span className="inline-flex items-center gap-1.5 text-ballpoint">
              <span className="size-1.5 rounded-full bg-ballpoint motion-safe:animate-pulse" aria-hidden />
              Updating{status.afterRun ? ` after run ${status.afterRun}` : ""}…
            </span>
          ) : saved ? (
            <span>
              numbers from W&B · updated after run {saved.after_run ?? "?"} · {saved.created_label}
            </span>
          ) : null}
          {canWrite && !updating && entryCount > 0 && !loadError && (
            <button
              type="button"
              onClick={onRegenerate}
              className="tap rounded-sm font-sans text-meta text-ballpoint underline underline-offset-4"
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
          <h3 id="insights-heading" className="mt-2 max-w-4xl font-display text-3xl leading-[1.02] font-extrabold tracking-tight text-balance sm:text-[2.875rem]">
            <span className="sr-only">What the runs say: </span>
            {body.headline}
          </h3>

          {stale && (
            <p className="mt-2 text-meta text-ochre">
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
                const metric: MetricKey = x.metric ?? x.comparison?.metric ?? (body?.metrics ? set.primary.key : "val_rmse");
                return (
                  <li key={i} className="grid gap-x-5 gap-y-0.5 py-3.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                    <p className={cn("font-display text-base leading-snug font-bold", TYPE_INK[x.type])}>
                      {TYPE_LABEL[x.type]}
                    </p>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "max-w-[72ch] leading-snug",
                          x.type === "lever" ? "text-hand font-medium text-graphite" : "text-body",
                          x.type === "no_effect" && "text-pencil",
                        )}
                      >
                        {x.text}
                      </p>
                      {x.prediction ? (
                        <PredictionNote p={x.prediction} onGo={onGoToRun} />
                      ) : x.type === "prediction_check" ? (
                        x.predicted &&
                        actual && (
                          <p className="mt-1.5 text-note text-pencil">
                            <span className="font-hand text-hand text-graphite">“{x.predicted}”</span>{" "}
                            <RunLink n={actual.n} onGo={onGoToRun} /> came in at{" "}
                            <span className="font-mono text-graphite tabular-nums">
                              {metricValue(actual, metric, set)?.toFixed(3) ?? "—"}
                            </span>
                          </p>
                        )
                      ) : (
                        <Trail x={x} metric={metric} set={set} onGo={onGoToRun} />
                      )}
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
              className="tap mt-2 rounded-sm text-note text-ballpoint underline underline-offset-4"
            >
              {showAll
                ? "Show fewer"
                : `Show ${hiddenCount} more prediction ${hiddenCount === 1 ? "check" : "checks"}`}
            </button>
          )}

          <details className="mt-2 text-note text-pencil">
            <summary className="tap w-fit cursor-pointer rounded-sm text-ballpoint">What the labels mean</summary>
            <dl className="mt-2 grid max-w-3xl gap-x-5 gap-y-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
              {(Object.keys(TYPE_LABEL) as InsightType[]).map((t) => (
                <Fragment key={t}>
                  <dt className={cn("font-display text-base leading-snug font-bold", TYPE_INK[t])}>{TYPE_LABEL[t]}</dt>
                  <dd className="max-w-[72ch]">{TYPE_HELP[t]}</dd>
                </Fragment>
              ))}
            </dl>
          </details>

          <div className="mt-4 grid gap-x-5 gap-y-1 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
            <p className="font-display text-lg leading-snug font-extrabold text-graphite">Try next</p>
            <div className="min-w-0">
              <p className="max-w-[72ch] text-body leading-snug font-medium">{body.next_experiment.text}</p>
              {body.next_experiment.why && <p className="mt-0.5 text-note text-pencil">{body.next_experiment.why}</p>}
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
    </RunHref.Provider>
  );
}
