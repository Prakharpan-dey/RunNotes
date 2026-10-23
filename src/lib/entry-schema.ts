import { z } from "zod";

export const VERDICTS = ["keep", "discard", "inconclusive"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What Gemini writes. No metric values: those are filled in from W&B in code. */
export const EntryDraftSchema = z.object({
  title: z.string().min(3).max(120).describe("Short plain-English headline for this run, no metric values"),
  hypothesis: z
    .string()
    .max(400)
    .describe("What the person expected or was testing. Empty string if they didn't say"),
  changes: z
    .array(z.string().max(200))
    .max(10)
    .describe("What changed versus the previous run, one item each, e.g. 'model: lgbm -> svr'"),
  observations: z.array(z.string().max(300)).max(10).describe("What the person noticed, in their words, cleaned up"),
  verdict: z.enum(VERDICTS).describe("keep, discard or inconclusive"),
  next_steps: z.array(z.string().max(200)).max(6).describe("What they plan to try next"),
  tags: z
    .array(z.string().max(30))
    .max(5)
    .describe("1-5 short lowercase topic tags, e.g. 'features', 'model-choice'"),
});
export type EntryDraft = z.infer<typeof EntryDraftSchema>;

export type MetricResult = {
  key: string;
  value: number | null;
  prev: number | null;
  delta: number | null;
  improved: boolean | null;
};

export type ConfigChange = { key: string; from: unknown; to: unknown };

/** Stored in entries.entry: the draft plus facts computed in code. */
export type Entry = EntryDraft & {
  metrics: MetricResult[];
  config_changes: ConfigChange[];
  prev_run: { id: string; name: string } | null;
  model: string;
};

export type SavedEntry = {
  id: string;
  run_id: string;
  raw_notes: string;
  entry: Entry;
  created_at: string;
  /** created_at formatted in IST on the server. */
  created_label: string;
  /** When the last fix was applied, in IST; null if never fixed. */
  updated_label: string | null;
  /** How many earlier versions are kept in history. */
  fix_count: number;
};

/** One earlier version, kept in entries.history when a fix replaces it. */
export type HistoryItem = {
  raw_notes: string;
  entry: Entry;
  saved_at: string;
  replaced_at: string;
  correction: string;
};

export const EntryRequestSchema = z.object({
  runId: z.string().min(1).max(64),
  notes: z.string().trim().min(10, "Say a bit more about the run first.").max(8000),
});

export const FixRequestSchema = z.object({
  runId: z.string().min(1).max(64),
  correction: z.string().trim().min(3, "Say what's wrong first.").max(2000),
});

/** What Gemini returns for a fix: the corrected notes and the full corrected entry. */
export const FixResultSchema = z.object({
  notes: z.string().min(1).describe("The original notes with the correction applied; everything else unchanged"),
  entry: EntryDraftSchema,
});
