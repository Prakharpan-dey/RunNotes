import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { buildLedger, type LedgerRow } from "@/lib/ledger";
import { fetchRuns, WANDB_ENTITY, WANDB_PROJECT, WandbError } from "@/lib/wandb";
import { DbError, getEntries } from "@/lib/supabase";
import type { SavedEntry } from "@/lib/entry-schema";
import { getLatestInsights } from "@/lib/insights";
import type { SavedInsights } from "@/lib/insights-schema";
import { JournalView } from "@/components/journal-view";
import { OwnerFooter } from "@/components/owner-footer";
import { TryIt, type DemoRunSummary } from "@/components/try-it";
import { DEMO_LIMIT, DEMO_WINDOW_SECONDS, demoRun } from "@/lib/demo";
import { isOwner } from "@/lib/owner";

const PROJECT_URL = `https://wandb.ai/${WANDB_ENTITY}/${WANDB_PROJECT}`;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="font-display text-2xl font-extrabold tracking-wide uppercase">RunNotes</p>
        <p className="text-sm text-pencil">Experiment journal · talk after every run</p>
      </header>
      <Suspense fallback={<Sheet rows={null} />}>
        <LoadedSheet />
      </Suspense>
    </main>
  );
}

async function LoadedSheet() {
  await connection();
  let rows: LedgerRow[] = [];
  let entries: Record<string, SavedEntry> = {};
  let error: string | undefined;
  let notice: string | undefined;
  let insights: SavedInsights | null = null;
  let insightsError: string | null = null;
  let demo: DemoRunSummary | null = null;
  const [runsResult, entriesResult, insightsResult, owner] = await Promise.allSettled([
    fetchRuns(),
    getEntries(),
    getLatestInsights(),
    isOwner(),
  ]);
  const canWrite = owner.status === "fulfilled" && owner.value;
  if (runsResult.status === "fulfilled") {
    rows = buildLedger(runsResult.value);
    const picked = demoRun(runsResult.value);
    const row = picked && rows.find((r) => r.id === picked.run.id);
    if (picked && row) {
      demo = {
        id: row.id,
        n: row.n,
        name: row.name,
        config: row.config,
        rmse: row.rmse.value,
        pearson: row.pearson.value,
        prevRunNumber: row.n > 1 ? row.n - 1 : null,
        url: row.url,
      };
    }
  } else {
    const err = runsResult.reason;
    if (!(err instanceof WandbError)) console.error(err);
    error = err instanceof WandbError ? err.message : "Couldn't load runs from W&B.";
  }
  if (entriesResult.status === "fulfilled") {
    entries = entriesResult.value;
  } else {
    const err = entriesResult.reason;
    if (!(err instanceof DbError)) console.error(err);
    notice = err instanceof DbError ? err.message : "Couldn't load saved entries.";
  }
  if (insightsResult.status === "fulfilled") {
    insights = insightsResult.value;
  } else {
    const err = insightsResult.reason;
    if (!(err instanceof DbError)) console.error(err);
    insightsError = err instanceof DbError ? err.message : "Couldn't load insights.";
  }
  return (
    <>
      {demo && <TryIt run={demo} limit={DEMO_LIMIT} windowHours={DEMO_WINDOW_SECONDS / 3600} />}
      <Sheet
        rows={rows}
        entries={entries}
        insights={insights}
        insightsError={insightsError}
        error={error}
        notice={notice}
        canWrite={canWrite}
      />
      <OwnerFooter isOwner={canWrite} />
    </>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 border-graphite/70 px-4 py-3 ${className ?? ""}`}>
      <p className="font-display text-xs font-bold tracking-[0.14em] text-pencil uppercase">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Sheet({
  rows,
  entries = {},
  insights = null,
  insightsError = null,
  error,
  notice,
  canWrite = false,
}: {
  rows: LedgerRow[] | null;
  entries?: Record<string, SavedEntry>;
  insights?: SavedInsights | null;
  insightsError?: string | null;
  error?: string;
  notice?: string;
  canWrite?: boolean;
}) {
  const logged = rows?.filter((r) => entries[r.id]).length ?? 0;
  const best = rows?.find((r) => r.isBest);
  const latest = rows?.[0];
  const pending = <span className="font-mono text-sm text-pencil/60">…</span>;

  return (
    <section className="border-2 border-graphite/80 bg-paper/85 shadow-[4px_4px_0_0_rgb(35_41_31/0.12)]">
      {/* Title block, as in the corner of an engineering drawing */}
      <div className="grid grid-cols-3 border-b-2 border-graphite/80 md:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]">
        <Field label="Project" className="col-span-3 border-b md:col-span-1 md:border-r md:border-b-0">
          <h1 className="truncate font-display text-5xl leading-[0.9] font-extrabold tracking-tight sm:text-6xl">
            {WANDB_PROJECT}
          </h1>
        </Field>
        <Field label="Runs" className="border-r">
          {rows ? (
            <p className="font-mono text-lg tabular-nums">
              {rows.length}
              <span className="block text-[11px] text-pencil">{logged} with entries</span>
            </p>
          ) : (
            pending
          )}
        </Field>
        <Field label="Best run" className="border-r">
          {rows ? (
            best ? (
              <p className="font-mono text-lg tabular-nums">
                {best.rmse.value!.toFixed(3)}{" "}
                <span className="block text-[11px] text-pencil">
                  val_rmse · run {best.n}
                </span>
              </p>
            ) : (
              <p className="font-mono text-lg text-pencil/60">—</p>
            )
          ) : (
            pending
          )}
        </Field>
        <Field label="Last run">
          {rows ? <p className="text-sm">{latest ? latest.started : "—"}</p> : pending}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-graphite/40 px-4 py-2 text-[12px] text-pencil">
        <p className="min-w-0 truncate font-mono">{WANDB_ENTITY}</p>
        <a href={PROJECT_URL} target="_blank" rel="noreferrer" className="rounded-sm text-ballpoint underline underline-offset-4">
          Open project in W&B ↗
        </a>
      </div>

      {rows === null ? (
        <p className="px-4 py-10 text-sm text-pencil">Pulling runs from W&B…</p>
      ) : error ? (
        <div className="px-4 py-10">
          <p className="font-hand text-xl text-correction">Couldn&apos;t load runs.</p>
          <p className="mt-1 max-w-prose text-sm">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10">
          <p className="font-hand text-xl text-ballpoint">No runs on this sheet yet.</p>
          <p className="mt-1 max-w-prose text-sm text-pencil">
            Log one with <code className="font-mono text-[12px]">wandb.init(project=&quot;{WANDB_PROJECT}&quot;)</code>, then
            reload this page.
          </p>
        </div>
      ) : (
        <>
          {notice && (
            <p role="status" className="border-b border-graphite/40 bg-ochre/10 px-4 py-2 text-[13px] text-ochre">
              {notice}
            </p>
          )}
          <JournalView
            rows={rows}
            entries={entries}
            insights={insights}
            insightsError={insightsError}
            canWrite={canWrite}
          />
        </>
      )}
    </section>
  );
}
