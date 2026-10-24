import { Suspense } from "react";
import { connection } from "next/server";
import { buildLedger, type LedgerRow } from "@/lib/ledger";
import { fetchRuns, WANDB_ENTITY, WANDB_PROJECT, WandbError } from "@/lib/wandb";
import { DbError, getEntries, OWNER_WORKSPACE } from "@/lib/supabase";
import type { SavedEntry } from "@/lib/entry-schema";
import { getLatestInsights } from "@/lib/insights";
import type { SavedInsights } from "@/lib/insights-schema";
import { OWNER_METRICS } from "@/lib/metrics";
import { JournalSheet } from "@/components/journal-sheet";
import { ModeTabs, PageHeader } from "@/components/mode-tabs";
import { OwnerFooter } from "@/components/owner-footer";
import { TryIt, type DemoRunSummary } from "@/components/try-it";
import { DEMO_LIMIT, DEMO_WINDOW_SECONDS, demoRun } from "@/lib/demo";
import { isOwner } from "@/lib/owner";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader />
      <ModeTabs active="journal" />
      <Suspense fallback={<JournalSheet entity={WANDB_ENTITY} project={WANDB_PROJECT} metrics={OWNER_METRICS} rows={null} />}>
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
    getEntries(OWNER_WORKSPACE),
    getLatestInsights({ workspace: OWNER_WORKSPACE, project: WANDB_PROJECT }),
    isOwner(),
  ]);
  const canWrite = owner.status === "fulfilled" && owner.value;
  if (runsResult.status === "fulfilled") {
    rows = buildLedger(runsResult.value, OWNER_METRICS);
    const picked = demoRun(runsResult.value);
    const row = picked && rows.find((r) => r.id === picked.run.id);
    if (picked && row) {
      demo = {
        id: row.id,
        n: row.n,
        name: row.name,
        config: row.config,
        rmse: row.primary.value,
        pearson: row.secondary?.value ?? null,
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
      <JournalSheet
        entity={WANDB_ENTITY}
        project={WANDB_PROJECT}
        metrics={OWNER_METRICS}
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
