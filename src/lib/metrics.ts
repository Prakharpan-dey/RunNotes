/**
 * Which W&B summary metrics a journal tracks. The owner's journal uses val_rmse and
 * val_pearson; a visitor workspace uses whatever they pick on the Connect page.
 */

export type MetricSpec = {
  /** The W&B summary key, e.g. "val_rmse". */
  key: string;
  /** How it's named in sentences, e.g. "RMSE". */
  label: string;
  higherIsBetter: boolean;
};

export type MetricSet = {
  /** Drives the best run, levers, no-effect and regressions. */
  primary: MetricSpec;
  /** Shown alongside and usable in predictions; optional. */
  secondary: MetricSpec | null;
};

/**
 * Thresholds relative to the best main-metric value so far. On the owner's runs (best around
 * 0.67) they come to about 0.01 noise and 0.1 for a regression.
 */
export const NOISE_REL = 0.015;
export const REGRESSION_REL = 0.15;
/** A prediction "around X" holds within this fraction of |X|. */
export const AROUND_REL = 0.03;

export const OWNER_METRICS: MetricSet = {
  primary: { key: "val_rmse", label: "RMSE", higherIsBetter: false },
  secondary: { key: "val_pearson", label: "Pearson", higherIsBetter: true },
};

/** "val_loss" -> "loss", "eval/accuracy" -> "accuracy", "val_rmse" -> "RMSE". */
export function labelFor(key: string): string {
  const last = key.split(/[/.]/).pop() ?? key;
  const words = last.replace(/^(val|valid|validation|eval|test|train)[_-]?/i, "").replace(/[_-]+/g, " ").trim() || last;
  return /^(rmse|mse|mae|auc|f1|map|ndcg|bleu|wer|cer|iou)$/i.test(words) ? words.toUpperCase() : words;
}

export function metricList(set: MetricSet): MetricSpec[] {
  return set.secondary ? [set.primary, set.secondary] : [set.primary];
}

/** true = better, false = worse, null = no change. */
export function improved(spec: MetricSpec, delta: number): boolean | null {
  if (delta === 0) return null;
  return spec.higherIsBetter ? delta > 0 : delta < 0;
}
