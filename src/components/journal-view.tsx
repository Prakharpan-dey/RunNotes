"use client";

import { useEffect, useRef, useState } from "react";
import type { LedgerRow } from "@/lib/ledger";
import type { SavedEntry } from "@/lib/entry-schema";
import type { SavedInsights } from "@/lib/insights-schema";
import type { MetricSet } from "@/lib/metrics";
import { useApiFetch } from "@/components/api-context";
import { InsightsPanel, type InsightsStatus } from "@/components/insights-panel";
import { RunsTable } from "@/components/runs-table";

const POLL_MS = 3000;
// Gemini can take ~15 s, or longer with retries when it's overloaded.
const GIVE_UP_MS = 130_000;

/** Insights panel and runs table together, so an insight can open the run it cites. */
export function JournalView({
  rows,
  entries,
  insights: initialInsights,
  insightsError,
  canWrite,
  wandbLinks,
  metrics,
}: {
  canWrite: boolean;
  wandbLinks: boolean;
  metrics: MetricSet;
  rows: LedgerRow[];
  entries: Record<string, SavedEntry>;
  insights: SavedInsights | null;
  insightsError: string | null;
}) {
  const [insights, setInsights] = useState(initialInsights);
  const [status, setStatus] = useState<InsightsStatus>({ kind: "idle" });
  const [loggedIds, setLoggedIds] = useState(() => new Set(Object.keys(entries)));
  const [open, setOpen] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insightsRef = useRef(insights);
  const apiFetch = useApiFetch();

  useEffect(() => {
    insightsRef.current = insights;
  }, [insights]);
  useEffect(() => () => void (poll.current && clearTimeout(poll.current)), []);

  const byNumber = new Map(rows.map((r) => [r.n, r.id]));
  const numberOf = new Map(rows.map((r) => [r.id, r.n]));

  /** The server rebuilds insights after an entry is saved; poll until a new version appears. */
  function watchForRebuild(afterRun: number | null) {
    if (poll.current) clearTimeout(poll.current);
    const baselineId = insightsRef.current?.id ?? null;
    const started = Date.now();
    setStatus({ kind: "updating", afterRun });

    const tick = async () => {
      try {
        const res = await apiFetch("/api/insights", { cache: "no-store" });
        const body = await res.json();
        if (res.ok && body.insights && body.insights.id !== baselineId) {
          setInsights(body.insights);
          setStatus({ kind: "idle" });
          return;
        }
      } catch {
        // Network blip: keep polling until the deadline.
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setStatus({ kind: "error", message: "Insights didn’t update. Press Regenerate to try again." });
        return;
      }
      poll.current = setTimeout(tick, POLL_MS);
    };
    poll.current = setTimeout(tick, POLL_MS);
  }

  async function regenerate() {
    if (poll.current) clearTimeout(poll.current);
    setStatus({ kind: "updating", afterRun: null });
    try {
      const res = await apiFetch("/api/insights", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setInsights(body.insights);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Couldn’t build insights." });
    }
  }

  function goToRun(n: number) {
    const id = byNumber.get(n);
    if (!id) return;
    setOpen(id);
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(id);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`run-row-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  }

  return (
    <>
      <InsightsPanel
        saved={insights}
        status={status}
        entryCount={loggedIds.size}
        loadError={insightsError}
        onRegenerate={regenerate}
        onGoToRun={goToRun}
        runHref={(n) => (byNumber.has(n) ? `#run-row-${byNumber.get(n)}` : "#")}
        canWrite={canWrite}
        metrics={metrics}
      />
      <RunsTable
        rows={rows}
        initialEntries={entries}
        open={open}
        onOpenChange={setOpen}
        flashId={flashId}
        canWrite={canWrite}
        wandbLinks={wandbLinks}
        metrics={metrics}
        onEntryChanged={(runId) => {
          setLoggedIds((prev) => (prev.has(runId) ? prev : new Set(prev).add(runId)));
          if (!insightsError) watchForRebuild(numberOf.get(runId) ?? null);
        }}
      />
    </>
  );
}
