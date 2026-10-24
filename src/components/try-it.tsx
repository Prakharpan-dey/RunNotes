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
};

/**
 * "Try it yourself": dictate about a real run and get an entry card back, without saving it.
 * Folded to one line until opened, so the journal itself is the first thing on the page.
 */
export function TryIt({ run, limit, windowHours }: { run: DemoRunSummary; limit: number; windowHours: number }) {
  const [open, setOpen] = useState(false);
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
      className="mb-6 border-2 border-dashed border-graphite/50 bg-paper-raised/60 px-4 py-3 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="min-w-0 text-body leading-snug">
          <span id="try-heading" className="font-display text-xl font-extrabold tracking-tight">
            Try it yourself.
          </span>{" "}
          <span className="text-pencil">
            Talk through run {run.n} as if you’d just finished it and get a journal entry back. Nothing is saved.
          </span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="try-body"
          className="tap shrink-0 rounded-sm text-note font-medium text-ballpoint underline underline-offset-4"
        >
          {open ? "Close" : `Write a demo entry for run ${run.n}`}
        </button>
      </div>

      {open && (
        <div id="try-body" className="mt-4 border-t border-dashed border-graphite/25 pt-4">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-meta">
            <div className="flex gap-2">
              <dt className="whitespace-nowrap text-pencil">run {run.n}</dt>
              <dd>{run.name}</dd>
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
          <p className="mt-2 max-w-prose text-note text-pencil">
            Hold Fn with Wispr Flow, or type. Say what you changed and what you saw; the numbers come from W&B.{" "}
            {limit} tries every {windowHours} hours.
          </p>

          <div className="mt-4">
            {result ? (
              <div className="max-w-3xl">
                <EntryCard saved={result.entry} previous={null} runNumber={run.n} prevRunNumber={run.prevRunNumber} demo />
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-note text-pencil">
                  <button
                    type="button"
                    onClick={() => {
                      setResult(null);
                      setAttempt((a) => a + 1);
                    }}
                    className="tap rounded-sm text-ballpoint underline underline-offset-4"
                  >
                    Try again
                  </button>
                  {result.triesLeft !== null && (
                    <span>
                      {result.triesLeft === 0
                        ? "That was your last try for now."
                        : `${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`}
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <EntryComposer
                key={attempt}
                runId={run.id}
                endpoint="/api/demo/entry"
                hint="Hold Fn and talk, or type"
                buttonLabel="Write demo entry"
                pendingLabel="Writing demo entry…"
                helper="Try a self-correction: “we used twenty MFCCs, no wait, forty”."
                onSaved={(entry, body) =>
                  setResult({ entry, triesLeft: typeof body.triesLeft === "number" ? body.triesLeft : null })
                }
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
