"use client";

import { useState } from "react";
import { EntryCard } from "@/components/entry-card";
import { EntryComposer } from "@/components/entry-composer";
import type { SavedEntry } from "@/lib/entry-schema";

export type DemoRunSummary = {
  id: string;
  n: number;
  name: string;
  config: Record<string, unknown>;
  rmse: number | null;
  pearson: number | null;
  prevRunNumber: number | null;
  url: string;
};

/** "Try it yourself": dictate about a real run and get an entry card back, without saving it. */
export function TryIt({ run, limit, windowHours }: { run: DemoRunSummary; limit: number; windowHours: number }) {
  const [result, setResult] = useState<{ entry: SavedEntry; triesLeft: number | null } | null>(null);
  // Remount the composer after each try so it starts empty.
  const [attempt, setAttempt] = useState(0);

  const configLine = Object.entries(run.config)
    .filter(([k]) => ["model", "features", "n_mfcc"].includes(k))
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");

  return (
    <section
      aria-labelledby="try-heading"
      className="mb-8 border-2 border-dashed border-graphite/60 bg-paper-raised/70 px-4 py-5 sm:px-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="try-heading" className="font-display text-xs font-bold tracking-[0.14em] text-pencil uppercase">
          Try it yourself
        </h2>
        <p className="text-[12px] text-pencil">
          Nothing you write here is saved. {limit} tries every {windowHours} hours.
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-[15px] leading-snug">
        Pretend you just finished this run. Hold Fn with Wispr Flow (or type) and ramble about what you changed and
        what you saw. RunNotes turns it into a journal entry, with the numbers taken from W&B.
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-y border-dashed border-graphite/25 py-2 font-mono text-[12px]">
        <div className="flex gap-2">
          <dt className="whitespace-nowrap text-pencil">run {run.n}</dt>
          <dd>
            <a href={run.url} target="_blank" rel="noreferrer" className="rounded-sm text-ballpoint underline underline-offset-4">
              {run.name}
            </a>
          </dd>
        </div>
        {configLine && <dd className="text-pencil">{configLine}</dd>}
        <div className="flex gap-2">
          <dt className="text-pencil">val_rmse</dt>
          <dd className="tabular-nums">{run.rmse?.toFixed(3) ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-pencil">val_pearson</dt>
          <dd className="tabular-nums">{run.pearson?.toFixed(3) ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-4">
        {result ? (
          <div className="max-w-3xl">
            <EntryCard saved={result.entry} previous={null} prevRunNumber={run.prevRunNumber} demo />
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-pencil">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setAttempt((a) => a + 1);
                }}
                className="rounded-sm text-ballpoint underline underline-offset-4"
              >
                Try again
              </button>
              {result.triesLeft !== null && (
                <span>
                  {result.triesLeft === 0 ? "That was your last try for now." : `${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`}
                </span>
              )}
            </p>
          </div>
        ) : (
          <EntryComposer
            key={attempt}
            runId={run.id}
            endpoint="/api/demo/entry"
            placeholder="Hold Fn and talk, or type"
            buttonLabel="Write demo entry"
            pendingLabel="Writing demo entry…"
            helper="Try a self-correction: “we used twenty MFCCs, no wait, forty”."
            onSaved={(entry, body) =>
              setResult({ entry, triesLeft: typeof body.triesLeft === "number" ? body.triesLeft : null })
            }
          />
        )}
      </div>
    </section>
  );
}
