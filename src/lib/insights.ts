import "server-only";
import { createHash } from "crypto";
import { configChanges, EntryError, findLeakedNumber, generate, spokenNumbersToDigits } from "@/lib/entry-writer";
import type { ConfigChange } from "@/lib/entry-schema";
import { describeChange } from "@/lib/config-words";
import type { JournalContext } from "@/lib/context";
import { formatIst, num } from "@/lib/ledger";
import { AROUND_REL, improved, NOISE_REL, REGRESSION_REL, type MetricSet, type MetricSpec } from "@/lib/metrics";
import { db, DbError, getEntryRows, type EntryRow } from "@/lib/supabase";
import { fetchRuns, type Run } from "@/lib/wandb";
import {
  HEADLINE_MAX_WORDS,
  InsightsWriteSchema,
  PredictionExtractSchema,
  type Comparator,
  type ExtractionCache,
  type Insight,
  type InsightsBody,
  type InsightsWrite,
  type MetricRole,
  type PredictionResult,
  type RunFact,
  type SavedInsights,
} from "@/lib/insights-schema";

/** Caps so a long journal keeps the panel readable; the newest facts win. */
const MAX_PER_TYPE = 4;

/** Bump when the extraction rules change, so cached extractions are redone. */
const EXTRACTION_VERSION = "v3";

type Row = { run: Run; n: number; entry: EntryRow | null };

/* ---------- Step 1: facts, computed in code from W&B ---------- */

type LeverFact = { id: string; type: "lever"; run: number; prevBest: number; delta: number; changes: string[] };
/**
 * `changes` are the config differences from the best run. `main` are the ones carried over
 * from earlier runs (what's really being compared); `alongside` were changed in this run too,
 * e.g. run 6 keeps run 5's embeddings (main) and raises alpha (alongside).
 */
type NoEffectFact = {
  id: string;
  type: "no_effect";
  run: number;
  best: number;
  delta: number;
  changes: string[];
  main: string[];
  alongside: string[];
};
type RegressionFact = {
  id: string;
  type: "regression";
  run: number;
  best: number;
  delta: number;
  changes: string[];
  /** The next run, if it got back within noise of the best. */
  recovery: { run: number; delta: number; changes: string[] } | null;
};
type PredictionFact = { id: string; type: "prediction_check"; result: PredictionResult };
type ScoreFact = LeverFact | NoEffectFact | RegressionFact;
type Fact = ScoreFact | PredictionFact;

function valueOf(row: Row, spec: MetricSpec): number | null {
  return num(row.run.summary[spec.key]);
}

/** A readable phrase for one config change, e.g. "adding text features", "setting alpha to 100". */
function formatChange(c: ConfigChange): string {
  return describeChange(c);
}

function describeChanges(from: Run, to: Run): string[] {
  return configChanges(from, to).map(formatChange);
}

/**
 * Walks the runs in order, tracking the best main-metric value so far. Compared with that best,
 * with noise = NOISE_REL x |best| and regression = REGRESSION_REL x |best|: better by more than
 * noise is a lever, within noise is no-effect, worse by more than the regression threshold is a
 * regression. Climbing back after a bad run is never a lever.
 */
function scoreFacts(rows: Row[], primary: MetricSpec): ScoreFact[] {
  const facts: ScoreFact[] = [];
  // Positive gain = better, whichever direction the metric goes.
  const gain = (v: number, bestV: number) => (primary.higherIsBetter ? v - bestV : bestV - v);
  let best: Row | null = null;
  rows.forEach((row, i) => {
    const v = valueOf(row, primary);
    if (v === null) return;
    if (best) {
      const bestV = valueOf(best, primary)!;
      const noise = NOISE_REL * Math.abs(bestV);
      const regression = REGRESSION_REL * Math.abs(bestV);
      const delta = v - bestV;
      const g = gain(v, bestV);
      const vsBest = configChanges(best.run, row.run);
      const changes = vsBest.map(formatChange);
      if (g > noise) {
        facts.push({ id: `lever-${row.n}`, type: "lever", run: row.n, prevBest: best.n, delta, changes });
      } else if (Math.abs(g) <= noise) {
        // What changed in this run itself (vs the run before) is tuning; the rest is the real comparison.
        const prev = rows[i - 1];
        const tunedKeys = new Set(prev ? configChanges(prev.run, row.run).map((c) => c.key) : []);
        let main = vsBest.filter((c) => !tunedKeys.has(c.key));
        let alongside = vsBest.filter((c) => tunedKeys.has(c.key));
        if (main.length === 0) [main, alongside] = [vsBest, []];
        facts.push({
          id: `no-effect-${row.n}`,
          type: "no_effect",
          run: row.n,
          best: best.n,
          delta,
          changes,
          main: main.map(formatChange),
          alongside: alongside.map(formatChange),
        });
      } else if (-g > regression) {
        const next = rows[i + 1];
        const nextV = next ? valueOf(next, primary) : null;
        const recovered = next && nextV !== null && gain(nextV, bestV) >= -noise;
        facts.push({
          id: `regression-${row.n}`,
          type: "regression",
          run: row.n,
          best: best.n,
          delta,
          changes,
          recovery: recovered ? { run: next.n, delta: nextV - bestV, changes: describeChanges(row.run, next.run) } : null,
        });
      }
    }
    if (!best || gain(v, valueOf(best, primary)!) > 0) best = row;
  });
  return facts;
}

function held(c: Comparator, actual: number, target: number, spec: MetricSpec): boolean {
  if (c === "above") return actual > target;
  if (c === "below") return actual < target;
  if (c === "beat_run") return spec.higherIsBetter ? actual > target : actual < target;
  return Math.abs(actual - target) <= AROUND_REL * Math.abs(target);
}

/** Which way a prediction points, so two phrasings of the same expectation are recognised as one. */
function direction(c: Comparator, spec: MetricSpec): "up" | "down" | "around" {
  if (c === "around") return "around";
  if (c === "beat_run") return spec.higherIsBetter ? "up" : "down";
  return c === "above" ? "up" : "down";
}

type Extracted = {
  run: number;
  about: "this_run" | "next_run";
  metric: MetricRole;
  comparison: Comparator;
  value: number | null;
  beat_run: number | null;
  quote: string;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

/** "run four" -> "run 4", and "zero point six seven" -> "0.67". */
function normalizeNumbers(text: string): string {
  return spokenNumbersToDigits(text).replace(
    new RegExp(`\\brun\\s+(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi"),
    (_, w: string) => `run ${NUMBER_WORDS[w.toLowerCase()]}`,
  );
}

/** Extra words people use for common metrics. */
const SYNONYMS: Record<string, string[]> = {
  rmse: ["rmse", "mse", "error"],
  mse: ["mse", "error"],
  mae: ["mae", "error"],
  loss: ["loss"],
  pearson: ["pearson", "correlation", "corr"],
  spearman: ["spearman", "correlation"],
  accuracy: ["accuracy", "acc"],
  acc: ["accuracy", "acc"],
  f1: ["f1"],
  auc: ["auc"],
};

/** Words that name a metric, from its W&B key and label: "val_rmse" -> rmse, mse, error. */
function wordsFor(spec: MetricSpec): string[] {
  const parts = `${spec.key} ${spec.label}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !["val", "valid", "validation", "eval", "test", "train", "score", "mean", "avg"].includes(p));
  return [...new Set(parts.flatMap((p) => SYNONYMS[p] ?? [p]))];
}

/** Which of the journal's metrics a phrase names; null if neither or both. */
function metricFromWords(text: string, metrics: MetricSet): MetricRole | null {
  const has = (spec: MetricSpec | null) =>
    !!spec && wordsFor(spec).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  const p = has(metrics.primary);
  const s = has(metrics.secondary);
  if (p === s) return null;
  return p ? "primary" : "secondary";
}

/**
 * The metric a prediction is about: named in the quote, else in its sentence in the notes.
 * "Score" and "beat run N" mean the primary metric. Null when it can't be told.
 */
function inferMetric(p: Extracted, notes: string, metrics: MetricSet): MetricRole | null {
  const quote = normalizeNumbers(p.quote);
  const fromQuote = metricFromWords(quote, metrics);
  if (fromQuote) return fromQuote;
  const key = quote.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
  const sentence =
    notes.split(/(?<=[.!?])\s+/).find((s) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").includes(key)) ?? "";
  const fromSentence = metricFromWords(sentence, metrics);
  if (fromSentence) return fromSentence;
  if (p.comparison === "beat_run" || /\bscore\b/i.test(`${quote} ${sentence}`)) return "primary";
  return null;
}

/**
 * Predictions are tested on the run they're about: the same run for "I expected this to beat
 * run 4", the next run for "next time it should come back below 0.67". Only misses become
 * insights. The value (or the run to beat) must appear in the notes, and a later restatement
 * of the same expectation for the same run ("I said it should drop below run four") is dropped.
 */
function predictionFacts(rows: Row[], extracted: Extracted[], metrics: MetricSet): PredictionFact[] {
  const seen = new Set<string>();
  const facts: PredictionFact[] = [];
  const order = (p: Extracted) => p.run * 2 + (p.about === "this_run" ? 0 : 1);
  for (const p of [...extracted].sort((a, b) => order(a) - order(b))) {
    const source = rows[p.run - 1];
    const tested = p.about === "this_run" ? source : rows[p.run];
    if (!source?.entry || !tested) continue;
    const notes = normalizeNumbers(source.entry.raw_notes);

    let target: number | null;
    if (p.comparison === "beat_run") {
      const ref = p.beat_run;
      if (!ref || ref >= tested.n || !new RegExp(`\\brun\\s+${ref}\\b`, "i").test(notes)) continue;
      target = null; // filled in once the metric is known
    } else {
      if (p.value === null || !new RegExp(`(^|[^\\d.])${String(p.value).replace(".", "\\.")}`).test(notes)) continue;
      target = p.value;
    }

    const role = inferMetric(p, notes, metrics);
    const spec = role === "secondary" ? metrics.secondary : role === "primary" ? metrics.primary : null;
    if (!spec) continue;
    if (p.comparison === "beat_run") target = valueOf(rows[p.beat_run! - 1], spec);
    if (target === null) continue;

    const key = `${tested.n}|${spec.key}|${direction(p.comparison, spec)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const actual = valueOf(tested, spec);
    if (actual === null || held(p.comparison, actual, target, spec)) continue;
    const delta = actual - target;
    facts.push({
      id: `prediction-${p.run}-${tested.n}-${spec.key}`,
      type: "prediction_check",
      result: {
        source_run: p.run,
        tested_run: tested.n,
        metric: spec.key,
        comparison: p.comparison,
        predicted: target,
        ...(p.comparison === "beat_run" ? { target_run: p.beat_run! } : {}),
        actual,
        delta,
        better: improved(spec, delta),
        quote: p.quote,
      },
    });
  }
  return facts;
}

/* ---------- Step 2: prediction extraction (Gemini, cached per notes) ---------- */

function describeMetrics(metrics: MetricSet): string {
  const line = (role: string, spec: MetricSpec) =>
    `- ${role}: ${spec.key} ("${spec.label}", ${spec.higherIsBetter ? "higher" : "lower"} is better). Also called: ${wordsFor(spec).join(", ")}.`;
  return [line("primary", metrics.primary), metrics.secondary ? line("secondary", metrics.secondary) : "- secondary: none"].join("\n");
}

const EXTRACT_SYSTEM = `You extract predictions from an ML researcher's spoken notes. You do not judge them.

Each block is one run's notes, dictated after that run finished. Extract every prediction about a score that has a number or a run to beat:
- "maybe RMSE around 0.65", "I expect Pearson above zero point six", "the score should come back below zero point six seven" (about the next run)
- "I expected this to beat run four", "this should beat run 4" (an expectation for the run these notes are about)
- "next time it should beat run four" (about the next run)

Fields:
- about: this_run if it was the expectation for the run these notes describe ("I expected this to..."); next_run if it's about the next experiment.
- metric: primary or secondary, using METRICS below. "The score" means primary.
- comparison: above, below, around ("about", "roughly", "maybe X" count as around), or beat_run for beating another run.
- value: the number in digits ("zero point six seven" -> 0.67); null for beat_run.
- beat_run: the run number to beat ("run four" -> 4); null otherwise.
- quote: the words of the prediction, copied from the notes.

Skip results being reported ("RMSE was 0.70"), predictions with no number and no run to beat, predictions about a metric not in METRICS, and restatements of a prediction made in an earlier run's notes ("I said that..., and it didn't", "I predicted Pearson above 0.6 so..."). Return an empty list if there are none.`;

function hashNotes(notes: string, metrics: MetricSet): string {
  const metricKey = `${metrics.primary.key}|${metrics.secondary?.key ?? ""}`;
  return createHash("sha1").update(`${EXTRACTION_VERSION}:${metricKey}:${notes}`).digest("hex").slice(0, 16);
}

async function extractPredictions(
  rows: Row[],
  cache: ExtractionCache,
  ctx: JournalContext,
): Promise<{ extracted: Extracted[]; cache: ExtractionCache }> {
  const next: ExtractionCache = {};
  const todo: Row[] = [];
  for (const row of rows) {
    if (!row.entry) continue;
    const hash = hashNotes(row.entry.raw_notes, ctx.metrics);
    const hit = cache[row.run.id];
    if (hit && hit.notes_hash === hash) next[row.run.id] = hit;
    else todo.push(row);
  }

  if (todo.length) {
    const prompt = `METRICS\n${describeMetrics(ctx.metrics)}\n\n${todo
      .map((r) => `RUN ${r.n} NOTES\n"""\n${r.entry!.raw_notes}\n"""`)
      .join("\n\n")}`;
    const { value } = await generate(PredictionExtractSchema, EXTRACT_SYSTEM, prompt, "Regenerate", () => null, {
      temperature: 0,
      geminiKey: ctx.geminiKey,
    });
    for (const row of todo) {
      next[row.run.id] = {
        notes_hash: hashNotes(row.entry!.raw_notes, ctx.metrics),
        items: value.predictions.filter((p) => p.run === row.n),
      };
    }
  }

  const byId = new Map(rows.map((r) => [r.run.id, r.n]));
  const extracted = Object.entries(next).flatMap(([runId, c]) =>
    // Run numbers can shift if runs are deleted in W&B; re-anchor them to the run id.
    c.items.map((p) => ({ ...p, run: byId.get(runId) ?? p.run })),
  );
  return { extracted, cache: next };
}

/* ---------- Step 3: sentences (Gemini, words only) ---------- */

const WRITE_SYSTEM = `You write the words for an ML experiment journal's insights panel. The facts are already decided by code; you only phrase them.

Write:
- headline: at most ${HEADLINE_MAX_WORDS} words: the takeaway across all the facts, led by the HEADLINE FACT. Say what it means next to the others, e.g. "Text features are the only change that has helped so far." or "Text features helped; embeddings keep making things worse." Never repeat or paraphrase one of your sentences.
- sentences: exactly one plain-English sentence for every fact id given, and no other ids. Keep each fact's meaning:
  - lever: this change set a new best score compared with the previous best run. Name the setting that changed.
  - no_effect: main_change made no real difference compared with the best run so far. Name main_change as the thing that didn't matter; mention changed_alongside only as what came with it, never as the cause, e.g. "Adding sentence embeddings, along with setting alpha to 100, made no real difference compared with the best run so far."
  - regression: this change made the score much worse than the best run so far. If recovered_by is given, add that the next run recovered and what it changed, e.g. "Run 5 got much worse after adding sentence embeddings; run 6 recovered by setting alpha to 100." Use the person's own explanation from the run titles if there is one, attributed ("I think it overfit").
  - prediction_check: what I predicted, before which change, and that the result missed it. First person, natural, e.g. "I expected Pearson above 0.6 from adding text features, but it came in below that." For "beat run N", say I expected it to beat run N and it didn't.
- next_experiment: the one experiment most worth running next, and why, from the facts and the person's own next steps.

Rules:
- No metric values, score differences or percentages, except the predicted value inside a prediction_check sentence.
- Don't add claims beyond the facts. Explanations from the notes are the person's guesses: attribute them ("I suspect...").
- Plain English. Changes are already written as "-ing" phrases ("adding text features", "switching from Ridge to LightGBM", "setting alpha to 100"). Use them after "by", "from" or "after", or as the subject ("Adding sentence embeddings made no real difference"). Start every sentence with a capital letter. Keep model names capitalised as given.`;

/** Share of the shorter text's words that also appear in the other, 0 to 1. */
function overlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(1, Math.min(wa.size, wb.size));
}

function runLabel(rows: Row[], n: number): string {
  const row = rows[n - 1];
  return row.entry?.entry.title ? `run ${n} ("${row.entry.entry.title}")` : `run ${n} (${row.run.name})`;
}

function labelOf(metrics: MetricSet, key: string): string {
  return metrics.primary.key === key ? metrics.primary.label : metrics.secondary?.key === key ? metrics.secondary.label : key;
}

/** The prediction in words; for beat_run the target is named by run, so no W&B number appears. */
function predictionWords(r: PredictionResult, metrics: MetricSet): string {
  const name = labelOf(metrics, r.metric);
  return r.comparison === "beat_run" ? `${name} better than run ${r.target_run}` : `${name} ${r.comparison} ${r.predicted}`;
}

function factForModel(rows: Row[], f: Fact, metrics: MetricSet) {
  if (f.type === "lever") {
    return { id: f.id, type: f.type, run: runLabel(rows, f.run), previous_best: runLabel(rows, f.prevBest), changed_vs_previous_best: f.changes };
  }
  if (f.type === "no_effect") {
    return {
      id: f.id,
      type: f.type,
      run: runLabel(rows, f.run),
      best_so_far: runLabel(rows, f.best),
      main_change: f.main,
      changed_alongside: f.alongside,
    };
  }
  if (f.type === "regression") {
    return {
      id: f.id,
      type: f.type,
      run: runLabel(rows, f.run),
      best_so_far: runLabel(rows, f.best),
      changed_vs_best: f.changes,
      recovered_by: f.recovery
        ? { run: runLabel(rows, f.recovery.run), changed_vs_regressed_run: f.recovery.changes }
        : null,
    };
  }
  const r = f.result;
  const testedRow = rows[r.tested_run - 1];
  const before = rows[r.tested_run - 2];
  return {
    id: f.id,
    type: f.type,
    predicted_in: runLabel(rows, r.source_run),
    tested_by: runLabel(rows, r.tested_run),
    prediction: predictionWords(r, metrics),
    change_tested: before ? describeChanges(before.run, testedRow.run) : [],
    outcome:
      r.comparison === "beat_run"
        ? `did not beat run ${r.target_run}`
        : r.actual > r.predicted
          ? "came in above the prediction"
          : "came in below the prediction",
  };
}

/** ["adding text features", "setting alpha to 100"] -> "adding text features and setting alpha to 100". */
function plain(changes: string[]): string {
  if (changes.length === 0) return "the same config";
  if (changes.length === 1) return changes[0];
  return `${changes.slice(0, -1).join(", ")} and ${changes[changes.length - 1]}`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain sentence from the fact alone, used when the model leaves one out. */
function templateSentence(f: Fact, metrics: MetricSet): string {
  if (f.type === "lever") {
    return `Run ${f.run} set a new best over run ${f.prevBest} by ${plain(f.changes)}.`;
  }
  if (f.type === "no_effect") {
    const alongside = f.alongside.length ? `, along with ${plain(f.alongside)},` : "";
    return `${capitalise(plain(f.main))}${alongside} made no real difference compared with run ${f.best}, the best so far.`;
  }
  if (f.type === "regression") {
    const recovered = f.recovery ? `; run ${f.recovery.run} recovered by ${plain(f.recovery.changes)}` : "";
    return `Run ${f.run} got much worse than run ${f.best}, the best so far, after ${plain(f.changes)}${recovered}.`;
  }
  const r = f.result;
  const outcome = r.comparison === "beat_run" ? "it didn't" : `run ${r.tested_run} came in ${r.actual > r.predicted ? "above" : "below"} it`;
  return `Run ${r.source_run}'s notes predicted ${predictionWords(r, metrics)}; ${outcome}.`;
}

/** "Run N set a new best: description", built from the headline fact alone. */
function templateHeadline(rows: Row[], f: Fact | null, bestRun: number | null): string {
  const describe = (changes: string[], run: number) => (changes.length ? plain(changes) : rows[run - 1].run.name);
  if (f?.type === "lever") return `Run ${f.run} set a new best: ${describe(f.changes, f.run)}`;
  if (f?.type === "regression") return `Run ${f.run} got much worse: ${describe(f.changes, f.run)}`;
  if (f?.type === "prediction_check") return `Run ${f.result.tested_run} missed the prediction from run ${f.result.source_run}`;
  if (f?.type === "no_effect") return `Run ${f.run} made no real difference: ${describe(f.main, f.run)}`;
  return bestRun ? `Run ${bestRun} is the best so far` : "No scored runs yet";
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/* ---------- Assembly ---------- */

function runFact(rows: Row[], n: number, metrics: MetricSet): RunFact {
  const row = rows[n - 1];
  return {
    n,
    id: row.run.id,
    name: row.run.name,
    primary: valueOf(row, metrics.primary),
    secondary: metrics.secondary ? valueOf(row, metrics.secondary) : null,
  };
}

function toInsight(rows: Row[], f: Fact, text: string, metrics: MetricSet): Insight {
  if (f.type === "prediction_check") {
    const r = f.result;
    const runs = [...new Set([r.source_run, r.target_run, r.tested_run].filter((n): n is number => n !== undefined))].sort(
      (a, b) => a - b,
    );
    return {
      id: f.id,
      type: f.type,
      text,
      runs,
      metric: r.metric,
      facts: runs.map((n) => runFact(rows, n, metrics)),
      comparison: null,
      prediction: r,
    };
  }
  const key = metrics.primary.key;
  const from = f.type === "lever" ? f.prevBest : f.best;
  const runs = [from, f.run, ...(f.type === "regression" && f.recovery ? [f.recovery.run] : [])];
  return {
    id: f.id,
    type: f.type,
    text,
    runs,
    metric: key,
    facts: runs.map((n) => runFact(rows, n, metrics)),
    // No-effect is within noise by definition, so it's neither better nor worse: grey.
    comparison: {
      from,
      to: f.run,
      delta: f.delta,
      metric: key,
      improved: f.type === "no_effect" ? null : improved(metrics.primary, f.delta),
    },
    recovery:
      f.type === "regression" && f.recovery
        ? { from, to: f.recovery.run, delta: f.recovery.delta, metric: key, improved: null }
        : null,
  };
}

function newest<T extends Fact>(facts: T[], runOf: (f: T) => number): T[] {
  return [...facts].sort((a, b) => runOf(b) - runOf(a)).slice(0, MAX_PER_TYPE);
}

/** Builds insights without saving them. `cache` is the previous version's prediction extractions. */
export async function buildInsights(
  ctx: JournalContext,
  triggerRunId?: string,
  cache: ExtractionCache = {},
): Promise<{ body: InsightsBody; afterRun: number; entryCount: number }> {
  const { metrics } = ctx;
  const [runs, entryRows] = await Promise.all([fetchRuns(ctx.source), getEntryRows(ctx.workspace)]);
  const byRun = new Map(entryRows.map((e) => [e.run_id, e]));
  const rows: Row[] = [...runs]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((run, i) => ({ run, n: i + 1, entry: byRun.get(run.id) ?? null }));
  const logged = rows.filter((r) => r.entry);
  if (logged.length === 0) throw new EntryError("Write an entry first; insights are built from your entries.", 400);

  // 1. Facts, in code.
  const scored = scoreFacts(rows, metrics.primary);
  const { extracted, cache: extractions } = await extractPredictions(rows, cache, ctx);
  const levers = newest(scored.filter((f): f is LeverFact => f.type === "lever"), (f) => f.run);
  const predictions = newest(predictionFacts(rows, extracted, metrics), (f) => f.result.tested_run);
  const regressions = newest(scored.filter((f): f is RegressionFact => f.type === "regression"), (f) => f.run);
  const noEffects = newest(scored.filter((f): f is NoEffectFact => f.type === "no_effect"), (f) => f.run);
  const facts: Fact[] = [...levers, ...regressions, ...predictions, ...noEffects];

  // The headline is about the most important fact: the latest new best, else the latest regression,
  // else the latest missed prediction.
  const headlineFact = levers[0] ?? regressions[0] ?? predictions[0] ?? noEffects[0] ?? null;
  const better = (a: number, b: number) => (metrics.primary.higherIsBetter ? a > b : a < b);
  const bestRun =
    rows.reduce<Row | null>((b, r) => {
      const v = valueOf(r, metrics.primary);
      return v !== null && (!b || better(v, valueOf(b, metrics.primary)!)) ? r : b;
    }, null)?.n ?? null;

  // 2. Words, from Gemini, for exactly these facts.
  const ids = facts.map((f) => f.id);
  const latest = logged[logged.length - 1];
  const prompt = `FACTS\n${JSON.stringify(facts.map((f) => factForModel(rows, f, metrics)), null, 1)}

HEADLINE FACT: ${headlineFact ? headlineFact.id : "none; say which run is best so far"}

LATEST NEXT STEPS (from run ${latest.n}'s entry): ${JSON.stringify(latest.entry!.entry.next_steps)}`;

  const wandbNumbers: (number | null)[] = rows.flatMap((r) => [
    valueOf(r, metrics.primary),
    metrics.secondary ? valueOf(r, metrics.secondary) : null,
  ]);
  for (const f of [...levers, ...regressions, ...noEffects]) wandbNumbers.push(f.delta);
  for (const f of regressions) if (f.recovery) wandbNumbers.push(f.recovery.delta);

  // A prediction sentence may repeat its own predicted value ("below 0.67"), even when that
  // happens to equal a W&B score rounded (run 4's 0.6724), so it's removed before checking.
  const ownValue = new Map(
    predictions
      .filter((p) => p.result.comparison !== "beat_run")
      .map((p) => [p.id, spokenNumbersToDigits(String(p.result.predicted))]),
  );
  const leakIn = (id: string, text: string): string | null => {
    const own = ownValue.get(id);
    const digits = spokenNumbersToDigits(text);
    return findLeakedNumber(own ? digits.split(own).join(" ") : digits, wandbNumbers);
  };
  for (const p of predictions) wandbNumbers.push(p.result.actual, p.result.delta);

  const { value: words, model } = await generate(
    InsightsWriteSchema,
    WRITE_SYSTEM,
    prompt,
    "Regenerate",
    (w: InsightsWrite) => {
      const problems: string[] = [];
      const got = new Set(w.sentences.map((s) => s.id));
      const missing = ids.filter((id) => !got.has(id));
      const extra = [...got].filter((id) => !ids.includes(id));
      if (missing.length) problems.push(`Write a sentence for these ids too: ${missing.join(", ")}.`);
      if (extra.length) problems.push(`Remove sentences for ids that weren't given: ${extra.join(", ")}.`);
      const echoed = w.sentences.find((s) => overlap(w.headline, s.text) > 0.75);
      if (echoed) {
        problems.push(`The headline repeats the sentence for ${echoed.id}. Make it the takeaway across all the facts instead.`);
      }
      if (wordCount(w.headline) > HEADLINE_MAX_WORDS) {
        problems.push(`The headline has ${wordCount(w.headline)} words; cut it to ${HEADLINE_MAX_WORDS} or fewer.`);
      }
      const leak =
        findLeakedNumber([w.headline, w.next_experiment], wandbNumbers) ??
        w.sentences.map((s) => leakIn(s.id, s.text)).find(Boolean) ??
        null;
      if (leak) problems.push(`Remove the metric value ${leak}; the app shows the numbers.`);
      return problems.length ? problems.join("\n") : null;
    },
    { temperature: 0, geminiKey: ctx.geminiKey },
  );

  // 3. Enforce the shape whatever came back: one sentence per fact, template if missing or leaking.
  const textById = new Map(words.sentences.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.text]));
  const insights = facts.map((f) => {
    const text = textById.get(f.id);
    return toInsight(rows, f, text && !leakIn(f.id, text) ? text : templateSentence(f, metrics), metrics);
  });
  const headlineOk = wordCount(words.headline) <= HEADLINE_MAX_WORDS && !findLeakedNumber(words.headline, wandbNumbers);

  const triggerN = triggerRunId ? rows.find((r) => r.run.id === triggerRunId)?.n : undefined;
  return {
    body: {
      headline: headlineOk ? words.headline : templateHeadline(rows, headlineFact, bestRun),
      headline_from_template: !headlineOk,
      insights,
      next_experiment: words.next_experiment,
      model,
      metrics,
      extractions,
    },
    afterRun: triggerN ?? Math.max(...logged.map((r) => r.n)),
    entryCount: logged.length,
  };
}

/* ---------- Storage ---------- */

function explain(message: string): string {
  if (/relation .*insights.* does not exist|Could not find the table/i.test(message)) {
    return "The insights table doesn't exist yet. Run supabase/003_insights.sql in the Supabase SQL editor.";
  }
  if (/workspace/i.test(message)) {
    return "The database isn't set up for workspaces yet. Run supabase/005_workspaces.sql in the Supabase SQL editor.";
  }
  return `Supabase error: ${message}`;
}

type InsightsRow = { id: string; insights: InsightsBody; after_run: number | null; entry_count: number; created_at: string };

function toSaved(row: InsightsRow): SavedInsights {
  // The extraction cache is server-side bookkeeping; don't ship it to the browser.
  const { extractions: _cache, ...insights } = row.insights;
  void _cache;
  return { ...row, insights, created_label: formatIst(row.created_at) };
}

/** Which saved insights to read: a journal (workspace) and its W&B project. */
export type InsightsScope = { workspace: string; project: string };

async function latestRow(scope: InsightsScope): Promise<InsightsRow | null> {
  const { data, error } = await db()
    .from("insights")
    .select("id, insights, after_run, entry_count, created_at")
    .eq("workspace", scope.workspace)
    .eq("project", scope.project)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DbError(explain(error.message));
  return data as InsightsRow | null;
}

export async function getLatestInsights(scope: InsightsScope): Promise<SavedInsights | null> {
  const row = await latestRow(scope);
  return row ? toSaved(row) : null;
}

/**
 * Rebuilds insights from every W&B run and every saved entry in the journal, saves a new
 * version, and returns it. `triggerRunId` is the run whose entry was just written or fixed.
 */
export async function regenerateInsights(ctx: JournalContext, triggerRunId?: string): Promise<SavedInsights> {
  const previous = await latestRow({ workspace: ctx.workspace, project: ctx.source.project });
  const built = await buildInsights(ctx, triggerRunId, previous?.insights.extractions ?? {});
  const { data, error } = await db()
    .from("insights")
    .insert({
      workspace: ctx.workspace,
      project: ctx.source.project,
      insights: built.body,
      after_run: built.afterRun,
      trigger_run_id: triggerRunId ?? null,
      entry_count: built.entryCount,
    })
    .select("id, insights, after_run, entry_count, created_at")
    .single();
  if (error) throw new DbError(explain(error.message));
  return toSaved(data as InsightsRow);
}
