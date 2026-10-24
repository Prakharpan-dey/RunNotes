import type { ConfigChange } from "@/lib/entry-schema";

/**
 * Turns a W&B config change into a short plain-English "-ing" phrase for insights, so it reads
 * naturally after "by", "from" or "after" and as a sentence subject, e.g.
 * features "acoustic" -> "acoustic+text"  =>  "adding text features"
 * model "ridge" -> "lgbm"                 =>  "switching from Ridge to LightGBM"
 * alpha (unset) -> 100                    =>  "setting alpha to 100"
 * Unknown keys fall back to "changing <key> from A to B". Add names here as new settings appear.
 */

const MODEL_NAMES: Record<string, string> = {
  ridge: "Ridge",
  lasso: "Lasso",
  linear: "linear regression",
  lgbm: "LightGBM",
  lightgbm: "LightGBM",
  xgb: "XGBoost",
  xgboost: "XGBoost",
  catboost: "CatBoost",
  svr: "SVR",
  rf: "random forest",
  mlp: "an MLP",
};

/** Parts of a "+"-joined feature set, e.g. "acoustic+text+emb". */
const FEATURE_NAMES: Record<string, string> = {
  acoustic: "acoustic features",
  text: "text features",
  emb: "sentence embeddings",
  embeddings: "sentence embeddings",
  whisper: "Whisper features",
};

const SETTING_NAMES: Record<string, string> = {
  n_mfcc: "the MFCC count",
  n_folds: "the number of folds",
  alpha: "alpha",
  lr: "the learning rate",
  learning_rate: "the learning rate",
  num_leaves: "the number of leaves",
  max_depth: "the max depth",
  seed: "the seed",
  drop_zero: "dropping zero-score clips",
};

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function featureChange(from: unknown, to: unknown): string {
  const parts = (v: unknown) => (typeof v === "string" ? v.split("+").map((p) => p.trim()).filter(Boolean) : []);
  const name = (p: string) => FEATURE_NAMES[p] ?? `${p} features`;
  const before = parts(from);
  const after = parts(to);
  const added = after.filter((p) => !before.includes(p)).map(name);
  const removed = before.filter((p) => !after.includes(p)).map(name);
  if (added.length && removed.length) return `swapping ${list(removed)} for ${list(added)}`;
  if (added.length) return `adding ${list(added)}`;
  if (removed.length) return `dropping ${list(removed)}`;
  return `changing the features from ${show(from)} to ${show(to)}`;
}

export function describeChange(c: ConfigChange): string {
  if (c.key === "features") return featureChange(c.from, c.to);
  if (c.key === "model") {
    const name = (v: unknown) => MODEL_NAMES[String(v).toLowerCase()] ?? show(v);
    if (c.from === null) return `using ${name(c.to)}`;
    return `switching from ${name(c.from)} to ${name(c.to)}`;
  }
  const setting = SETTING_NAMES[c.key] ?? c.key;
  if (typeof c.from === "boolean" || typeof c.to === "boolean") {
    return `turning ${c.to ? "on" : "off"} ${setting}`;
  }
  if (c.from === null || c.from === undefined) return `setting ${setting} to ${show(c.to)}`;
  if (c.to === null || c.to === undefined) return `removing ${setting}`;
  if (typeof c.from === "number" && typeof c.to === "number") {
    return `${c.to > c.from ? "raising" : "lowering"} ${setting} from ${c.from} to ${c.to}`;
  }
  return `changing ${setting} from ${show(c.from)} to ${show(c.to)}`;
}
