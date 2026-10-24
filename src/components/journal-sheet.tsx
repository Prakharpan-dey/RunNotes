import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { LedgerRow } from "@/lib/ledger";
import type { SavedEntry } from "@/lib/entry-schema";
import type { SavedInsights } from "@/lib/insights-schema";
import type { MetricSet } from "@/lib/metrics";
import { JournalView } from "@/components/journal-view";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 border-graphite/70 px-4 py-3 ${className ?? ""}`}>
      <p className="font-display text-xs font-bold tracking-[0.14em] text-pencil uppercase">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * One journal: the title block (project, runs, best run, last run) above the insights panel
 * and runs table. Used for the owner's journal and for visitor workspaces.
 */
export function JournalSheet({
  entity,
  project,
  metrics,
  rows,
  entries = {},
  insights = null,
  insightsError = null,
  error,
  notice,
  canWrite = false,
  wandbLinks = false,
}: {
  entity: string;
  project: string;
  metrics: MetricSet;
  rows: LedgerRow[] | null;
  entries?: Record<string, SavedEntry>;
  insights?: SavedInsights | null;
  insightsError?: string | null;
  error?: string;
  notice?: string;
  canWrite?: boolean;
  /** Link out to W&B. Off for the owner's journal: that project is private, so visitors would hit a sign-in wall. */
  wandbLinks?: boolean;
}) {
  const logged = rows?.filter((r) => entries[r.id]).length ?? 0;
  const best = rows?.find((r) => r.isBest);
  const latest = rows?.[0];
  const pending = <span className="font-mono text-sm text-pencil">…</span>;
  const projectUrl = `https://wandb.ai/${encodeURIComponent(entity)}/${encodeURIComponent(project)}`;

  return (
    <section className="pad border-2 border-graphite/80 shadow-sheet">
      {/* Title block, as in the corner of an engineering drawing */}
      <div className="grid grid-cols-3 border-b-2 border-graphite/80 md:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]">
        <Field label="Project" className="col-span-3 border-b md:col-span-1 md:border-r md:border-b-0">
          <h2 className="truncate font-display text-3xl leading-[0.95] font-extrabold tracking-tight">{project}</h2>
          {/* The W&B account name is shown with the links: in your own workspace, not on the public journal. */}
          {wandbLinks && (
            <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-meta text-pencil">
              <span className="min-w-0 truncate font-mono" title={entity}>
                {entity}
              </span>
              <a href={projectUrl} target="_blank" rel="noreferrer" className="tap shrink-0 rounded-sm text-ballpoint underline underline-offset-4">
                Open in W&B
                <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-2px]" aria-hidden />
              </a>
            </p>
          )}
        </Field>
        <Field label="Runs" className="border-r">
          {rows ? (
            <p className="font-mono text-lg tabular-nums">
              {rows.length}
              <span className="block text-meta text-pencil">{logged} with entries</span>
            </p>
          ) : (
            pending
          )}
        </Field>
        <Field label="Best run" className="border-r">
          {rows ? (
            best ? (
              <p className="font-mono text-lg tabular-nums">
                {best.primary.value!.toFixed(3)}{" "}
                <span className="block text-meta text-pencil">
                  {metrics.primary.key} · run {best.n}
                </span>
              </p>
            ) : (
              <p className="font-mono text-lg text-pencil">—</p>
            )
          ) : (
            pending
          )}
        </Field>
        <Field label="Last run">{rows ? <p className="text-sm">{latest ? latest.started : "—"}</p> : pending}</Field>
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
            Log one with <code className="font-mono text-meta">wandb.init(project=&quot;{project}&quot;)</code>, then reload
            this page.
          </p>
        </div>
      ) : (
        <>
          {notice && (
            <p role="status" className="border-b border-graphite/40 bg-ochre/10 px-4 py-2 text-note text-ochre">
              {notice}
            </p>
          )}
          <JournalView
            rows={rows}
            entries={entries}
            insights={insights}
            insightsError={insightsError}
            canWrite={canWrite}
            wandbLinks={wandbLinks}
            metrics={metrics}
          />
        </>
      )}
    </section>
  );
}
