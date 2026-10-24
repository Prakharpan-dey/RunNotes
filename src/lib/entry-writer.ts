import "server-only";
import { z } from "zod";
import { num } from "@/lib/ledger";
import { improved, metricList, type MetricSet, type MetricSpec } from "@/lib/metrics";
import { callModel } from "@/lib/llm";
import { EntryError } from "@/lib/errors";
import type { Run } from "@/lib/wandb";
import {
  EntryDraftSchema,
  FixResultSchema,
  type ConfigChange,
  type Entry,
  type EntryDraft,
  type MetricResult,
} from "@/lib/entry-schema";

export { EntryError } from "@/lib/errors";
export { MODELS } from "@/lib/llm";

/** What a call needs beyond its inputs: the journal's metrics and, for visitors, their own Gemini key. */
export type WriteOptions = { metrics: MetricSet; geminiKey: string | null };

const SYSTEM = `You turn an ML researcher's spoken notes about one training run into a short lab-notebook entry.

The notes were dictated with voice typing. Expect filler words (um, uh, like, so, basically), half-finished sentences, repeated words and self-corrections ("no wait, it was twenty", "actually scratch that"). When the speaker corrects themselves, keep only the corrected version. Write spoken numbers as digits ("twenty" -> 20, "two e minus four" -> 2e-4).

Rules:
- Use only what the notes and the run data say. Do not invent hypotheses, observations or plans the person didn't express.
- Never write metric values or metric changes (scores, percentages, deltas) in any field. The app shows the real numbers from W&B next to your entry. You may say a metric improved, got worse or stayed flat, using METRIC DIRECTIONS.
- changes: start from CONFIG CHANGES, formatted "key: old -> new". Add any other change the person mentions that isn't in the config (code, data, preprocessing). If there is no previous run, list the main setup choices instead.
- If the notes contradict the config about what changed, trust the config and add an observation pointing out the mismatch.
- verdict: "keep" if the person wants to build on this run, "discard" if they'd drop it, "inconclusive" if they say it's unclear. If they don't say, use METRIC DIRECTIONS: primary metric improved -> keep, got worse -> discard, mixed or no previous run -> inconclusive.
- title: plain English a non-ML reader can follow, at most 8 words, no numbers from metrics. Example: "Switching to LightGBM made scores worse".
- hypothesis: one sentence, or "" if they didn't say what they expected.
- Write in the person's own voice ("I"), concise, no "the user".`;

export function configChanges(prev: Run | null, run: Run): ConfigChange[] {
  if (!prev) return [];
  const keys = new Set([...Object.keys(prev.config), ...Object.keys(run.config)]);
  const changes: ConfigChange[] = [];
  for (const key of [...keys].sort()) {
    const from = prev.config[key];
    const to = run.config[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ key, from: from ?? null, to: to ?? null });
  }
  return changes;
}

function metricResults(prev: Run | null, run: Run, specs: MetricSpec[]): MetricResult[] {
  return specs.map((spec) => {
    const value = num(run.summary[spec.key]);
    const prevValue = prev ? num(prev.summary[spec.key]) : null;
    if (value === null || prevValue === null) return { key: spec.key, value, prev: prevValue, delta: null, improved: null };
    const delta = value - prevValue;
    return { key: spec.key, value, prev: prevValue, delta, improved: improved(spec, delta) };
  });
}

/** Directions for the prompt. `specs` gives each metric's direction; a stored entry may predate a change of metrics. */
function directions(metrics: MetricResult[], specs: MetricSpec[]): string {
  return metrics
    .map((m, i) => {
      const spec = specs.find((s) => s.key === m.key);
      const better = spec ? (spec.higherIsBetter ? "higher is better" : "lower is better") : "direction unknown";
      const moved =
        m.improved === null ? (m.delta === null ? "no previous value" : "unchanged") : m.improved ? "improved" : "got worse";
      return `- ${m.key}${i === 0 ? " (primary)" : ""}: ${better}; ${moved}`;
    })
    .join("\n");
}

function runBlock(run: Run) {
  return JSON.stringify({ name: run.name, config: run.config, summary_metrics: run.summary }, null, 2);
}

/** Metric values as they'd likely be written if the model copied them. */
function leakedMetric(draft: EntryDraft, metrics: MetricResult[]): string | null {
  return findLeakedNumber(draft, metrics.flatMap((m) => [m.value, m.prev, m.delta]));
}

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/** "zero point six five" -> "0.65". Dictated notes and model text both spell numbers out. */
export function spokenNumbersToDigits(text: string): string {
  const d = Object.keys(DIGIT_WORDS).join("|");
  return text.replace(new RegExp(`\\b((?:${d})(?:[\\s-]+(?:${d}))*)\\s+point((?:\\s+(?:${d}))+)\\b`, "gi"), (_, whole, frac) => {
    const digits = (s: string) => s.trim().split(/[\s-]+/).map((w) => DIGIT_WORDS[w.toLowerCase()]).join("");
    return `${digits(whole)}.${digits(frac)}`;
  });
}

/** Returns the first of `numbers` that appears in `value` (rounded to 2-4 places), or null. */
export function findLeakedNumber(value: unknown, numbers: (number | null)[]): string | null {
  // Catch "zero point seven" as well as "0.7".
  const text = spokenNumbersToDigits(JSON.stringify(value));
  for (const v of numbers) {
    if (v === null) continue;
    for (const digits of [2, 3, 4]) {
      const s = Math.abs(v).toFixed(digits);
      if (/[1-9]/.test(s) && new RegExp(`(^|[^\\d.])${s.replace(".", "\\.")}`).test(text)) return s;
    }
  }
  return null;
}

export async function writeEntry(runs: Run[], runId: string, notes: string, opts: WriteOptions): Promise<Entry> {
  const oldestFirst = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = oldestFirst.findIndex((r) => r.id === runId);
  if (i === -1) throw new EntryError(`Run ${runId} isn't in this W&B project.`, 404);
  const run = oldestFirst[i];
  const prev = i > 0 ? oldestFirst[i - 1] : null;

  const changes = configChanges(prev, run);
  const specs = metricList(opts.metrics);
  const metrics = metricResults(prev, run, specs);

  const prompt = `MY SPOKEN NOTES
"""
${notes}
"""

THIS RUN
${runBlock(run)}

PREVIOUS RUN
${prev ? runBlock(prev) : "None. This is the first run in the project."}

CONFIG CHANGES (computed from W&B, authoritative)
${changes.length ? changes.map((c) => `- ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join("\n") : "- none"}

METRIC DIRECTIONS (computed from W&B)
${directions(metrics, specs)}`;

  const { value: draft, model } = await generate(
    EntryDraftSchema,
    SYSTEM,
    prompt,
    "Write entry",
    (d) => {
      const leak = leakedMetric(d, metrics);
      return leak ? `Your last reply included the metric value ${leak}. Remove all metric values; say only whether metrics improved or got worse.` : null;
    },
    { geminiKey: opts.geminiKey },
  );

  return {
    ...cleanDraft(draft),
    metrics,
    config_changes: changes,
    prev_run: prev ? { id: prev.id, name: prev.name } : null,
    model,
  };
}

const FIX_SYSTEM = `You correct a lab-notebook entry about one ML training run. You get the current entry, the original spoken notes, and a spoken correction.

The correction was dictated with voice typing, so it may contain filler words and self-corrections of its own ("no wait, it was twenty"). Resolve those first, then apply what the person meant. Write spoken numbers as digits.

Return two things:
- notes: the original notes with the correction applied. Change only the words the correction is about and keep everything else exactly as written, same wording and punctuation. If the correction adds something, insert it where it fits. If it removes something ("drop the last point"), delete it.
- entry: the full corrected entry in the same schema. Apply the correction everywhere it matters (title, hypothesis, changes, observations, verdict, next_steps, tags). Copy every part the correction doesn't affect word for word.

Rules that still apply:
- Never write metric values or metric changes in the entry. The app shows the real numbers from W&B.
- LOGGED CONFIG and CONFIG CHANGES come from W&B and are authoritative: they record what actually ran. If the correction contradicts them (e.g. says 40 when W&B logged 20), still apply it to the notes, but keep the W&B value in "changes" and add an observation like "My notes say n_mfcc was 40, but W&B logged 20."
- If the correction asks for something unrelated to this entry, change nothing.`;

export async function fixEntry(
  current: Entry,
  notes: string,
  correction: string,
  loggedConfig: Record<string, unknown> | null,
  opts: WriteOptions,
): Promise<{ notes: string; entry: Entry }> {
  const { metrics, config_changes, prev_run, model: _model, ...draft } = current;
  void _model;

  const prompt = `CURRENT ENTRY
${JSON.stringify(draft, null, 2)}

ORIGINAL NOTES
"""
${notes}
"""

CORRECTION
"""
${correction}
"""

LOGGED CONFIG FOR THIS RUN (from W&B, authoritative)
${loggedConfig ? JSON.stringify(loggedConfig, null, 2) : "Unavailable right now."}

CONFIG CHANGES VS PREVIOUS RUN (computed from W&B, authoritative)
${config_changes.length ? config_changes.map((c) => `- ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join("\n") : "- none"}

METRIC DIRECTIONS (computed from W&B)
${directions(metrics, metricList(opts.metrics))}`;

  const { value: fixed, model } = await generate(
    FixResultSchema,
    FIX_SYSTEM,
    prompt,
    "Apply fix",
    (r) => {
      const leak = leakedMetric(r.entry, metrics);
      if (leak) return `Your last reply included the metric value ${leak} in the entry. Remove all metric values from the entry.`;
      if (r.notes.trim().length < notes.trim().length * 0.6) {
        return "Your corrected notes dropped too much of the original. Keep the original notes word for word except where the correction applies.";
      }
      return null;
    },
    { geminiKey: opts.geminiKey },
  );

  return {
    notes: fixed.notes.trim(),
    // Numbers and config changes stay exactly as they were computed from W&B.
    entry: { ...cleanDraft(fixed.entry), metrics, config_changes, prev_run, model },
  };
}

function cleanDraft(draft: EntryDraft): EntryDraft {
  return { ...draft, tags: [...new Set(draft.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] };
}

/**
 * Asks the model for strict JSON, validates it with Zod, and retries once with feedback
 * if the reply is malformed or `check` objects. A check failure on the last try is accepted.
 * `geminiKey` is a visitor's own key; null uses the server's.
 */
export async function generate<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
  action: string,
  check: (value: T) => string | null,
  { temperature = 0.3, geminiKey = null }: { temperature?: number; geminiKey?: string | null } = {},
): Promise<{ value: T; model: string }> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  let value: T | null = null;
  let model = "";
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await callModel({
      visitorKey: geminiKey,
      system,
      prompt: prompt + feedback,
      jsonSchema,
      temperature,
      action,
    });
    model = reply.model;

    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.text ?? "");
    } catch {
      feedback = "\n\nYour last reply wasn't valid JSON. Reply with only the JSON object.";
      continue;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      feedback = `\n\nYour last reply didn't match the schema: ${z.prettifyError(result.error)}. Fix it.`;
      continue;
    }
    value = result.data;
    const problem = check(value);
    if (problem && attempt === 0) {
      feedback = `\n\n${problem}`;
      continue;
    }
    break;
  }
  if (!value) throw new EntryError(`The model didn't return a valid entry. Press ${action} to try again.`);
  return { value, model };
}
