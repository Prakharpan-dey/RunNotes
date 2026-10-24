import { z } from "zod";
import type { MetricSet } from "@/lib/metrics";

export const INSIGHT_TYPES = ["lever", "no_effect", "regression", "prediction_check"] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];
/** A W&B summary key, e.g. "val_rmse". */
export type MetricKey = string;
/** Which of the journal's metrics a prediction is about. */
export const METRIC_ROLES = ["primary", "secondary"] as const;
export type MetricRole = (typeof METRIC_ROLES)[number];
/** "beat_run" means beating another run's score on the metric; its value comes from W&B. */
export const COMPARATORS = ["above", "below", "around", "beat_run"] as const;
export type Comparator = (typeof COMPARATORS)[number];
export const HEADLINE_MAX_WORDS = 15;

/**
 * Step 1 (Gemini): pull numeric predictions out of spoken notes. Nothing else.
 * Whether a prediction held is decided in code from W&B.
 */
export const PredictionExtractSchema = z.object({
  predictions: z
    .array(
      z.object({
        run: z.int().min(1).describe("The run number whose notes contain the prediction"),
        about: z
          .enum(["this_run", "next_run"])
          .describe("this_run if it was an expectation for the run these notes are about; next_run if it's about the next experiment"),
        metric: z.enum(METRIC_ROLES).describe("primary or secondary: which metric from METRICS the prediction is about"),
        comparison: z.enum(COMPARATORS).describe("above, below or around a value, or beat_run to beat another run's score"),
        value: z.number().nullable().describe("The predicted value as a number, e.g. 0.6 for 'zero point six'. null for beat_run"),
        beat_run: z.int().min(1).nullable().describe("For beat_run: the run number to beat, e.g. 4 for 'beat run four'. Otherwise null"),
        quote: z.string().max(200).describe("The words of the prediction, copied from the notes"),
      }),
    )
    .max(20),
});

/**
 * Step 2 (Gemini): words only, for facts the code already computed.
 * One sentence per fact id; it can't add or drop insights.
 */
export const InsightsWriteSchema = z.object({
  headline: z.string().min(3).max(160).describe(`At most ${HEADLINE_MAX_WORDS} words, about HEADLINE FACT. No metric values`),
  sentences: z
    .array(z.object({ id: z.string(), text: z.string().min(3).max(240) }))
    .describe("Exactly one sentence for every fact id, in any order"),
  next_experiment: z.object({
    text: z.string().min(5).max(200).describe("The one experiment to run next"),
    why: z.string().max(240).describe("Why, in one sentence, from the facts and notes. No metric values"),
  }),
});
export type InsightsWrite = z.infer<typeof InsightsWriteSchema>;

/** One run's numbers as shown next to an insight. Always from W&B. */
export type RunFact = {
  n: number;
  id: string;
  name: string;
  primary?: number | null;
  secondary?: number | null;
  /** Insights saved before metrics were configurable. */
  rmse?: number | null;
  pearson?: number | null;
};

/**
 * Metric change between two runs, computed in code: previous best -> run for levers and
 * no-effect. metric and improved are missing on insights saved before they were added.
 */
export type Comparison = { from: number; to: number; delta: number; metric?: MetricKey; improved?: boolean | null };

/** A prediction from the notes, checked against a run's W&B value. */
export type PredictionResult = {
  source_run: number;
  tested_run: number;
  metric: MetricKey;
  comparison: Comparator;
  /** The predicted value, or for beat_run the W&B score of the run to beat. */
  predicted: number;
  /** beat_run only: the run whose score was the target. */
  target_run?: number;
  actual: number;
  /** actual - predicted */
  delta: number;
  /** Whether the actual result was better than predicted, given the metric's direction. Drives the colour. */
  better: boolean | null;
  quote: string;
};

export type Insight = {
  /** Stable id from the facts, e.g. "lever-4", "prediction-3-4-val_pearson". */
  id?: string;
  type: InsightType;
  text: string;
  runs: number[];
  metric?: MetricKey | null;
  facts: RunFact[];
  comparison: Comparison | null;
  /** Regression only: best so far -> the run that got back within noise of it. */
  recovery?: Comparison | null;
  prediction?: PredictionResult;
  /** Older saved insights only: the quoted prediction. */
  predicted?: string | null;
};

/** Cached prediction extractions, keyed by W&B run id, reused while the notes are unchanged. */
export type ExtractionCache = Record<string, { notes_hash: string; items: z.infer<typeof PredictionExtractSchema>["predictions"] }>;

export type InsightsBody = {
  headline: string;
  insights: Insight[];
  next_experiment: InsightsWrite["next_experiment"];
  model: string;
  /** The metrics these insights were computed with, for labels and colours in the panel. */
  metrics?: MetricSet;
  /** True when the headline is the code template because the model's was too long. */
  headline_from_template?: boolean;
  extractions?: ExtractionCache;
};

export type SavedInsights = {
  id: string;
  insights: InsightsBody;
  after_run: number | null;
  entry_count: number;
  created_at: string;
  created_label: string;
};
