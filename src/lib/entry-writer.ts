import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { num, PEARSON, RMSE, type MetricSpec } from "@/lib/ledger";
import type { Run } from "@/lib/wandb";
import {
  EntryDraftSchema,
  FixResultSchema,
  type ConfigChange,
  type Entry,
  type EntryDraft,
  type MetricResult,
} from "@/lib/entry-schema";

/**
 * Tried in order. On the free tier each model has its own daily quota (20 requests for
 * gemini-3.5-flash), so falling back keeps RunNotes working when the first runs out.
 * Override with GEMINI_MODELS=a,b,c (or GEMINI_MODEL=a for a single model).
 */
export const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const METRICS: MetricSpec[] = [RMSE, PEARSON];

export class EntryError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const SYSTEM = `You turn an ML researcher's spoken notes about one training run into a short lab-notebook entry.

The notes were dictated with voice typing. Expect filler words (um, uh, like, so, basically), half-finished sentences, repeated words and self-corrections ("no wait, it was twenty", "actually scratch that"). When the speaker corrects themselves, keep only the corrected version. Write spoken numbers as digits ("twenty" -> 20, "two e minus four" -> 2e-4).

Rules:
- Use only what the notes and the run data say. Do not invent hypotheses, observations or plans the person didn't express.
- Never write metric values or metric changes (scores, RMSE, Pearson, percentages, deltas) in any field. The app shows the real numbers from W&B next to your entry. You may say a metric improved, got worse or stayed flat, using METRIC DIRECTIONS.
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

function metricResults(prev: Run | null, run: Run): MetricResult[] {
  return METRICS.map(({ key, higherIsBetter }) => {
    const value = num(run.summary[key]);
    const prevValue = prev ? num(prev.summary[key]) : null;
    if (value === null || prevValue === null) return { key, value, prev: prevValue, delta: null, improved: null };
    const delta = value - prevValue;
    return { key, value, prev: prevValue, delta, improved: delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0 };
  });
}

function directions(metrics: MetricResult[]): string {
  return metrics
    .map((m, i) => {
      const spec = METRICS[i];
      const better = spec.higherIsBetter ? "higher is better" : "lower is better";
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

let ai: GoogleGenAI | null = null;

export async function writeEntry(runs: Run[], runId: string, notes: string): Promise<Entry> {
  const oldestFirst = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = oldestFirst.findIndex((r) => r.id === runId);
  if (i === -1) throw new EntryError(`Run ${runId} isn't in this W&B project.`, 404);
  const run = oldestFirst[i];
  const prev = i > 0 ? oldestFirst[i - 1] : null;

  const changes = configChanges(prev, run);
  const metrics = metricResults(prev, run);

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
${directions(metrics)}`;

  const { value: draft, model } = await generate(EntryDraftSchema, SYSTEM, prompt, "Write entry", (d) => {
    const leak = leakedMetric(d, metrics);
    return leak ? `Your last reply included the metric value ${leak}. Remove all metric values; say only whether metrics improved or got worse.` : null;
  });

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
${directions(metrics)}`;

  const { value: fixed, model } = await generate(FixResultSchema, FIX_SYSTEM, prompt, "Apply fix", (r) => {
    const leak = leakedMetric(r.entry, metrics);
    if (leak) return `Your last reply included the metric value ${leak} in the entry. Remove all metric values from the entry.`;
    if (r.notes.trim().length < notes.trim().length * 0.6) {
      return "Your corrected notes dropped too much of the original. Keep the original notes word for word except where the correction applies.";
    }
    return null;
  });

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
 * Calls Gemini for strict JSON, validates it with Zod, and retries once with feedback
 * if the reply is malformed or `check` objects. A check failure on the last try is accepted.
 */
export async function generate<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
  action: string,
  check: (value: T) => string | null,
  { temperature = 0.3 }: { temperature?: number } = {},
): Promise<{ value: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new EntryError("No Gemini API key found. Add GEMINI_API_KEY to .env.local.", 500);
  ai ??= new GoogleGenAI({ apiKey: key });

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  let value: T | null = null;
  let model = MODELS[0];
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await callWithFallback(
      ai,
      {
        contents: prompt + feedback,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature,
        },
      },
      action,
    );
    const text = reply.text;
    model = reply.model;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text ?? "");
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
  if (!value) throw new EntryError(`Gemini didn't return a valid entry. Press ${action} to try again.`);
  return { value, model };
}

/** Models that ran out of quota, and when to try them again. Lives as long as the server process. */
const exhaustedUntil = new Map<string, number>();

function retryAfterMs(message: string): number {
  const s = message.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)s/i);
  // No hint: a per-minute limit clears in a minute; a daily one we re-check hourly.
  return s ? Number(s[1]) * 1000 : /PerDay/i.test(message) ? 3_600_000 : 60_000;
}

/**
 * Tries each model in MODELS in order. A model that's out of quota is skipped until its
 * quota resets; an overloaded one gets one quick retry before moving on.
 */
async function callWithFallback(
  client: GoogleGenAI,
  request: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">,
  action: string,
): Promise<{ text: string | undefined; model: string }> {
  const now = Date.now();
  const available = MODELS.filter((m) => (exhaustedUntil.get(m) ?? 0) <= now);
  let overloaded = false;

  for (const model of available) {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const res = await client.models.generateContent({ ...request, model });
        return { text: res.text, model };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)) {
          exhaustedUntil.set(model, Date.now() + retryAfterMs(message));
          console.warn(`Gemini ${model} is out of quota; trying the next model.`);
          break;
        }
        if (/\b50[03]\b|\b404\b|UNAVAILABLE|INTERNAL|NOT_FOUND|overloaded|high demand/i.test(message)) {
          overloaded = true;
          if (tries === 0 && !/\b404\b|NOT_FOUND/.test(message)) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          break;
        }
        throw new EntryError(`Gemini request failed: ${message.slice(0, 200)}`);
      }
    }
  }

  if (overloaded) {
    throw new EntryError(`Gemini is overloaded right now. Wait a few seconds and press ${action} again.`, 503);
  }
  const soonest = Math.min(...MODELS.map((m) => exhaustedUntil.get(m) ?? now));
  const minutes = Math.max(1, Math.round((soonest - now) / 60_000));
  const wait = minutes < 90 ? `${minutes} min` : `about ${Math.round(minutes / 60)} h`;
  throw new EntryError(
    `Gemini's free quota is used up on every model (${MODELS.join(", ")}). It frees up in ${wait}. ` +
      `To keep going now, set GEMINI_API_KEY to a key with billing enabled.`,
    429,
  );
}
