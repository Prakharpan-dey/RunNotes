import "server-only";
import { createHash } from "crypto";
import { configChanges, EntryError, findLeakedNumber, generate, spokenNumbersToDigits } from "@/lib/entry-writer";
import { formatIst, num, PEARSON, RMSE } from "@/lib/ledger";
import { db, DbError, getEntryRows, type EntryRow } from "@/lib/supabase";
import { fetchRuns, WANDB_PROJECT, type Run } from "@/lib/wandb";
import {
  HEADLINE_MAX_WORDS,
  InsightsWriteSchema,
  PredictionExtractSchema,
  type Comparator,
  type ExtractionCache,
  type Insight,
  type InsightsBody,
  type InsightsWrite,
  type MetricKey,
  type PredictionResult,
  type RunFact,
  type SavedInsights,
} from "@/lib/insights-schema";

/**
 * Smallest val_rmse move that counts as real. Folds on this dataset differ by about 0.03,
 * so a run within 0.01 of the best so far is treated as no different from it.
 */
const NOISE_RMSE = 0.01;

/** How close counts as "around" for a predicted value. */
const AROUND: Record<MetricKey, number> = { val_rmse: 0.02, val_pearson: 0.03 };

/** Caps so a long journal keeps the panel readable; the newest facts win. */
const MAX_PER_TYPE = 4;

type Row = { run: Run; n: number; entry: EntryRow | null };

/* ---------- Step 1: facts, computed in code from W&B ---------- */

type LeverFact = { id: string; type: "lever"; run: number; prevBest: number; delta: number; changes: string[] };
type NoEffectFact = { id: string; type: "no_effect"; run: number; best: number; delta: number; changes: string[] };
type PredictionFact = { id: string; type: "prediction_check"; result: PredictionResult };
type Fact = LeverFact | NoEffectFact | PredictionFact;

function metricOf(row: Row, metric: MetricKey): number | null {
  return num(row.run.summary[metric]);
}

function describeChanges(from: Run, to: Run): string[] {
  return configChanges(from, to).map((c) => `${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
}

/**
 * Walks the runs in order, tracking the best val_rmse so far. A run that beats it by more
 * than NOISE_RMSE is a lever; one within NOISE_RMSE of it is no-effect. Anything worse is
 * neither, and climbing back after a bad run never counts as a lever.
 */
function scoreFacts(rows: Row[]): (LeverFact | NoEffectFact)[] {
  const facts: (LeverFact | NoEffectFact)[] = [];
  let best: Row | null = null;
  for (const row of rows) {
    const v = metricOf(row, "val_rmse");
    if (v === null) continue;
    if (best) {
      const bestV = metricOf(best, "val_rmse")!;
      const delta = v - bestV;
      const changes = describeChanges(best.run, row.run);
      if (delta < -NOISE_RMSE) {
        facts.push({ id: `lever-${row.n}`, type: "lever", run: row.n, prevBest: best.n, delta, changes });
      } else if (Math.abs(delta) <= NOISE_RMSE) {
        facts.push({ id: `no-effect-${row.n}`, type: "no_effect", run: row.n, best: best.n, delta, changes });
      }
    }
    if (!best || v < metricOf(best, "val_rmse")!) best = row;
  }
  return facts;
}

function held(c: Comparator, actual: number, predicted: number, metric: MetricKey): boolean {
  if (c === "above") return actual > predicted;
  if (c === "below") return actual < predicted;
  return Math.abs(actual - predicted) <= AROUND[metric];
}

type Extracted = { run: number; metric: MetricKey; comparison: Comparator; value: number; quote: string };

/**
 * A prediction in run N's notes is about the next experiment, so it's tested on run N+1.
 * Only predictions that missed become insights. The value must appear in that run's notes.
 */
function predictionFacts(rows: Row[], extracted: Extracted[]): PredictionFact[] {
  const seen = new Set<string>();
  const facts: PredictionFact[] = [];
  for (const p of [...extracted].sort((a, b) => a.run - b.run)) {
    const source = rows[p.run - 1];
    const tested = rows[p.run];
    if (!source?.entry || !tested) continue;
    // The value must be in the notes, and the quote must name the same metric.
    const notes = spokenNumbersToDigits(source.entry.raw_notes);
    if (!new RegExp(`(^|[^\\d.])${String(p.value).replace(".", "\\.")}`).test(notes)) continue;
    if (metricFromWords(p.quote) !== p.metric) continue;
    // "I predicted Pearson above 0.6" in a later run's notes repeats the earlier prediction.
    const key = `${p.metric}|${p.comparison}|${p.value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const actual = metricOf(tested, p.metric);
    if (actual === null || held(p.comparison, actual, p.value, p.metric)) continue;
    const delta = actual - p.value;
    const higherIsBetter = p.metric === PEARSON.key;
    facts.push({
      id: `prediction-${p.run}-${p.metric}`,
      type: "prediction_check",
      result: {
        source_run: p.run,
        tested_run: tested.n,
        metric: p.metric,
        comparison: p.comparison,
        predicted: p.value,
        actual,
        delta,
        better: delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0,
        quote: p.quote,
      },
    });
  }
  return facts;
}

/** The metric a phrase is about, from its own words; null if it names neither or both. */
function metricFromWords(text: string): MetricKey | null {
  const rmse = /\b(rmse|mse|error|loss)\b/i.test(text);
  const pearson = /\b(pearson|correlation|corr)\b/i.test(text);
  if (rmse === pearson) return null;
  return rmse ? "val_rmse" : "val_pearson";
}

/* ---------- Step 2: prediction extraction (Gemini, cached per notes) ---------- */

const EXTRACT_SYSTEM = `You extract numeric predictions from an ML researcher's spoken notes. You do not judge them.

Each block is one run's notes, dictated after that run finished. Extract every forward-looking prediction about the score of the next experiment that names a metric and a number, e.g. "maybe RMSE around 0.65", "I expect Pearson above zero point six".
- metric: val_rmse if it is about RMSE, error or loss; val_pearson if it is about Pearson or correlation. If the metric isn't clear from the words, skip it.
- comparison: above, below or around ("about", "roughly", "maybe X" count as around).
- value: the number, in digits ("zero point six" -> 0.6).
- quote: the words of the prediction, copied from the notes.
Skip results being reported ("RMSE was 0.70"), predictions without a number, and references back to an earlier prediction ("I predicted Pearson above 0.6 so..."). Return an empty list if there are none.`;

function hashNotes(notes: string): string {
  return createHash("sha1").update(notes).digest("hex").slice(0, 16);
}

async function extractPredictions(
  rows: Row[],
  cache: ExtractionCache,
): Promise<{ extracted: Extracted[]; cache: ExtractionCache }> {
  const next: ExtractionCache = {};
  const todo: Row[] = [];
  for (const row of rows) {
    if (!row.entry) continue;
    const hash = hashNotes(row.entry.raw_notes);
    const hit = cache[row.run.id];
    if (hit && hit.notes_hash === hash) next[row.run.id] = hit;
    else todo.push(row);
  }

  if (todo.length) {
    const prompt = todo.map((r) => `RUN ${r.n} NOTES\n"""\n${r.entry!.raw_notes}\n"""`).join("\n\n");
    const { value } = await generate(PredictionExtractSchema, EXTRACT_SYSTEM, prompt, "Regenerate", () => null, {
      temperature: 0,
    });
    for (const row of todo) {
      next[row.run.id] = {
        notes_hash: hashNotes(row.entry!.raw_notes),
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
- headline: at most ${HEADLINE_MAX_WORDS} words, about the HEADLINE FACT only. Lead with the change, e.g. "Adding text features set a new best score."
- sentences: exactly one plain-English sentence for every fact id given, and no other ids. Keep each fact's meaning:
  - lever: this change set a new best score compared with the previous best run. Name the setting that changed.
  - no_effect: this change made no real difference compared with the best run so far.
  - prediction_check: what I predicted, before which change, and that the result came in above or below it. First person, natural, e.g. "I expected Pearson above 0.6 from adding text features, but it came in below that."
- next_experiment: the one experiment most worth running next, and why, from the facts and the person's own next steps.

Rules:
- No metric values, score differences or percentages, except the predicted value inside a prediction_check sentence.
- Don't add claims beyond the facts. Explanations from the notes are the person's guesses: attribute them ("I suspect...").
- Plain English. Name settings the way the person does ("text features", "LightGBM").`;

function runLabel(rows: Row[], n: number): string {
  const row = rows[n - 1];
  return row.entry?.entry.title ? `run ${n} ("${row.entry.entry.title}")` : `run ${n} (${row.run.name})`;
}

function factForModel(rows: Row[], f: Fact) {
  if (f.type === "lever") {
    return { id: f.id, type: f.type, run: runLabel(rows, f.run), previous_best: runLabel(rows, f.prevBest), changed_vs_previous_best: f.changes };
  }
  if (f.type === "no_effect") {
    return { id: f.id, type: f.type, run: runLabel(rows, f.run), best_so_far: runLabel(rows, f.best), changed_vs_best: f.changes };
  }
  const r = f.result;
  return {
    id: f.id,
    type: f.type,
    predicted_in: runLabel(rows, r.source_run),
    tested_by: runLabel(rows, r.tested_run),
    prediction: `${r.metric === "val_pearson" ? "Pearson" : "RMSE"} ${r.comparison} ${r.predicted}`,
    change_tested: describeChanges(rows[r.source_run - 1].run, rows[r.tested_run - 1].run),
    outcome: r.actual > r.predicted ? "came in above the prediction" : "came in below the prediction",
  };
}

/** Plain sentence from the fact alone, used when the model leaves one out. */
function templateSentence(rows: Row[], f: Fact): string {
  if (f.type === "lever") {
    return `Run ${f.run} set a new best over run ${f.prevBest}${f.changes.length ? ` by changing ${f.changes.join(", ")}` : ""}.`;
  }
  if (f.type === "no_effect") {
    return `Run ${f.run} landed level with the best so far (run ${f.best})${f.changes.length ? ` after changing ${f.changes.join(", ")}` : ""}.`;
  }
  const r = f.result;
  return `Run ${r.source_run}'s notes predicted ${r.metric === "val_pearson" ? "Pearson" : "RMSE"} ${r.comparison} ${r.predicted}; run ${r.tested_run} came in ${r.actual > r.predicted ? "above" : "below"} it.`;
}

/** "Run N set a new best: description", built from the headline fact alone. */
function templateHeadline(rows: Row[], f: Fact | null, bestRun: number | null): string {
  // `features: "acoustic" -> "acoustic+text"` reads as `features acoustic -> acoustic+text`.
  const describe = (changes: string[], run: number) =>
    changes.length ? changes.map((c) => c.replace(/"/g, "").replace(": ", " ")).join(", ") : rows[run - 1].run.name;
  if (f?.type === "lever") return `Run ${f.run} set a new best: ${describe(f.changes, f.run)}`;
  if (f?.type === "prediction_check") return `Run ${f.result.tested_run} missed the prediction from run ${f.result.source_run}`;
  if (f?.type === "no_effect") return `Run ${f.run} made no real difference: ${describe(f.changes, f.run)}`;
  return bestRun ? `Run ${bestRun} is the best so far` : "No scored runs yet";
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/* ---------- Assembly ---------- */

function runFact(rows: Row[], n: number): RunFact {
  const row = rows[n - 1];
  return { n, id: row.run.id, name: row.run.name, rmse: num(row.run.summary[RMSE.key]), pearson: num(row.run.summary[PEARSON.key]) };
}

function toInsight(rows: Row[], f: Fact, text: string): Insight {
  if (f.type === "prediction_check") {
    const r = f.result;
    return {
      id: f.id,
      type: f.type,
      text,
      runs: [r.source_run, r.tested_run],
      metric: r.metric,
      facts: [runFact(rows, r.source_run), runFact(rows, r.tested_run)],
      comparison: null,
      prediction: r,
    };
  }
  const from = f.type === "lever" ? f.prevBest : f.best;
  return {
    id: f.id,
    type: f.type,
    text,
    runs: [from, f.run],
    metric: "val_rmse",
    facts: [runFact(rows, from), runFact(rows, f.run)],
    // No-effect is within noise by definition, so it's neither better nor worse: grey.
    comparison: {
      from,
      to: f.run,
      delta: f.delta,
      metric: "val_rmse",
      improved: f.type === "no_effect" || f.delta === 0 ? null : f.delta < 0,
    },
  };
}

function newest<T extends Fact>(facts: T[], runOf: (f: T) => number): T[] {
  return [...facts].sort((a, b) => runOf(b) - runOf(a)).slice(0, MAX_PER_TYPE);
}

/** Builds insights without saving them. `cache` is the previous version's prediction extractions. */
export async function buildInsights(
  triggerRunId?: string,
  cache: ExtractionCache = {},
): Promise<{ body: InsightsBody; afterRun: number; entryCount: number }> {
  const [runs, entryRows] = await Promise.all([fetchRuns(), getEntryRows()]);
  const byRun = new Map(entryRows.map((e) => [e.run_id, e]));
  const rows: Row[] = [...runs]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((run, i) => ({ run, n: i + 1, entry: byRun.get(run.id) ?? null }));
  const logged = rows.filter((r) => r.entry);
  if (logged.length === 0) throw new EntryError("Write an entry first; insights are built from your entries.", 400);

  // 1. Facts, in code.
  const scored = scoreFacts(rows);
  const { extracted, cache: extractions } = await extractPredictions(rows, cache);
  const levers = newest(scored.filter((f): f is LeverFact => f.type === "lever"), (f) => f.run);
  const predictions = newest(predictionFacts(rows, extracted), (f) => f.result.tested_run);
  const noEffects = newest(scored.filter((f): f is NoEffectFact => f.type === "no_effect"), (f) => f.run);
  const facts: Fact[] = [...levers, ...predictions, ...noEffects];

  // The headline is about the most important fact: the latest new best, else the latest missed prediction.
  const headlineFact = levers[0] ?? predictions[0] ?? noEffects[0] ?? null;
  const bestRun = rows.reduce<Row | null>((b, r) => {
    const v = metricOf(r, "val_rmse");
    return v !== null && (!b || v < metricOf(b, "val_rmse")!) ? r : b;
  }, null)?.n ?? null;

  // 2. Words, from Gemini, for exactly these facts.
  const ids = facts.map((f) => f.id);
  const latest = logged[logged.length - 1];
  const prompt = `FACTS\n${JSON.stringify(facts.map((f) => factForModel(rows, f)), null, 1)}

HEADLINE FACT: ${headlineFact ? headlineFact.id : "none; say which run is best so far"}

LATEST NEXT STEPS (from run ${latest.n}'s entry): ${JSON.stringify(latest.entry!.entry.next_steps)}`;

  const wandbNumbers = rows.flatMap((r) => [metricOf(r, "val_rmse"), metricOf(r, "val_pearson")]);
  for (const f of [...levers, ...noEffects]) wandbNumbers.push(f.delta);
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
      if (wordCount(w.headline) > HEADLINE_MAX_WORDS) {
        problems.push(`The headline has ${wordCount(w.headline)} words; cut it to ${HEADLINE_MAX_WORDS} or fewer.`);
      }
      const leak = findLeakedNumber([w.headline, w.sentences.map((s) => s.text), w.next_experiment], wandbNumbers);
      if (leak) problems.push(`Remove the metric value ${leak}; the app shows the numbers.`);
      return problems.length ? problems.join("\n") : null;
    },
    { temperature: 0 },
  );

  // 3. Enforce the shape whatever came back: one sentence per fact, template if missing or leaking.
  const textById = new Map(words.sentences.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.text]));
  const insights = facts.map((f) => {
    const text = textById.get(f.id);
    return toInsight(rows, f, text && !findLeakedNumber(text, wandbNumbers) ? text : templateSentence(rows, f));
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
      extractions,
    },
    afterRun: triggerN ?? Math.max(...logged.map((r) => r.n)),
    entryCount: logged.length,
  };
}

/* ---------- Storage ---------- */

function explain(message: string): string {
  return /relation .*insights.* does not exist|Could not find the table/i.test(message)
    ? "The insights table doesn't exist yet. Run supabase/003_insights.sql in the Supabase SQL editor."
    : `Supabase error: ${message}`;
}

function toSaved(row: {
  id: string;
  insights: InsightsBody;
  after_run: number | null;
  entry_count: number;
  created_at: string;
}): SavedInsights {
  // The extraction cache is server-side bookkeeping; don't ship it to the browser.
  const { extractions: _cache, ...insights } = row.insights;
  void _cache;
  return { ...row, insights, created_label: formatIst(row.created_at) };
}

async function latestRow() {
  const { data, error } = await db()
    .from("insights")
    .select("id, insights, after_run, entry_count, created_at")
    .eq("project", WANDB_PROJECT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DbError(explain(error.message));
  return data as { id: string; insights: InsightsBody; after_run: number | null; entry_count: number; created_at: string } | null;
}

export async function getLatestInsights(): Promise<SavedInsights | null> {
  const row = await latestRow();
  return row ? toSaved(row) : null;
}

/**
 * Rebuilds insights from every W&B run and every saved entry, saves a new version,
 * and returns it. `triggerRunId` is the run whose entry was just written or fixed.
 */
export async function regenerateInsights(triggerRunId?: string): Promise<SavedInsights> {
  const previous = await latestRow();
  const built = await buildInsights(triggerRunId, previous?.insights.extractions ?? {});
  const { data, error } = await db()
    .from("insights")
    .insert({
      project: WANDB_PROJECT,
      insights: built.body,
      after_run: built.afterRun,
      trigger_run_id: triggerRunId ?? null,
      entry_count: built.entryCount,
    })
    .select("id, insights, after_run, entry_count, created_at")
    .single();
  if (error) throw new DbError(explain(error.message));
  return toSaved(data);
}
