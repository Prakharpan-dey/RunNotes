"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronRight, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedgerRow, MetricCell } from "@/lib/ledger";
import { improved, type MetricSet } from "@/lib/metrics";
import type { SavedEntry } from "@/lib/entry-schema";
import { EntryCard, type VsBest } from "@/components/entry-card";
import { EntryComposer } from "@/components/entry-composer";
import { FixBox } from "@/components/fix-box";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATE_STYLES: Record<string, string> = {
  finished: "border-graphite/40 text-graphite",
  running: "border-ballpoint text-ballpoint",
  crashed: "border-correction text-correction",
  failed: "border-correction text-correction",
  killed: "border-pencil/50 text-pencil",
};

function StateMark({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px font-mono text-meta lowercase",
        STATE_STYLES[state] ?? "border-pencil/50 text-pencil",
      )}
    >
      {state === "running" && (
        <span className="size-1.5 rounded-full bg-ballpoint motion-safe:animate-pulse" aria-hidden />
      )}
      {state}
    </span>
  );
}

function Delta({ cell }: { cell: MetricCell }) {
  if (cell.delta === null) return null;
  const sign = cell.delta > 0 ? "+" : cell.delta < 0 ? "−" : "±";
  return (
    <span
      className={cn(
        "font-mono text-meta",
        cell.improved === true && "text-ballpoint",
        cell.improved === false && "text-correction",
        cell.improved === null && "text-pencil",
      )}
      title={cell.improved === null ? "No change" : cell.improved ? "Better than the previous run" : "Worse than the previous run"}
    >
      {sign}
      {Math.abs(cell.delta).toFixed(3)}
    </span>
  );
}

function Value({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-pencil">—</span>;
  return <span className="font-mono text-note tabular-nums">{value.toFixed(3)}</span>;
}

/** Hand-drawn loop, like circling the best result in a lab book. */
function PenLoop() {
  return (
    <svg
      className="pen-loop pointer-events-none absolute -inset-x-3 -inset-y-2 h-[calc(100%+1rem)] w-[calc(100%+1.5rem)] overflow-visible"
      viewBox="0 0 104 38"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M14 9C30 2 78 1 95 10c9 6 6 17-9 22-20 6-58 6-75-1C1 26 2 15 12 10c8-4 16-5 26-6"
        pathLength={1}
        fill="none"
        stroke="var(--ballpoint)"
        strokeWidth={1.6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Run names differ at the end ("acoustic+text+emb-ridge-a100"), so let them wrap at + - _ rather than truncate. */
function breakable(name: string) {
  return name.split(/(?<=[+\-_/])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What this run changed in its config, against the run before it: the one thing worth reading in the config. */
function ConfigDiff({ config, prev, prevN }: { config: Record<string, unknown>; prev: Record<string, unknown> | null; prevN: number }) {
  if (!prev) return null;
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(config)])].sort((a, b) => a.localeCompare(b));
  const changed = keys.filter((k) => !same(prev[k], config[k]));
  const unchanged = keys.filter((k) => same(prev[k], config[k]) && config[k] !== undefined);
  const show = (v: unknown) => (v === undefined || v === null ? "unset" : formatValue(v));
  return (
    <div className="min-w-0">
      <h4 className="font-display text-base font-bold text-pencil">Config vs run {prevN}</h4>
      {changed.length === 0 ? (
        <p className="mt-1 text-note text-pencil">Same config as run {prevN}.</p>
      ) : (
        <ul className="mt-1.5 space-y-1 font-mono text-note">
          {changed.map((k) => (
            <li key={k} className="break-words">
              {k} <del className="text-pencil decoration-correction/70">{show(prev[k])}</del>
              <span className="text-pencil"> → </span>
              <ins className="text-ballpoint no-underline">{show(config[k])}</ins>
            </li>
          ))}
        </ul>
      )}
      {changed.length > 0 && unchanged.length > 0 && (
        <p className="mt-2 font-mono text-meta break-words text-pencil">
          <span className="font-sans">unchanged: </span>
          {unchanged.map((k) => `${k} ${show(config[k])}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toPrecision(6));
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function KeyValues({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="min-w-0">
      <h4 className="mb-2 font-display text-base font-bold text-pencil">{title}</h4>
      {entries.length === 0 ? (
        <p className="text-sm text-pencil">Nothing logged.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-meta">
          {entries.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="truncate text-pencil" title={k}>
                {k}
              </dt>
              <dd className="break-all text-graphite">{formatValue(v)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

export function RunsTable({
  rows,
  initialEntries,
  open,
  onOpenChange: setOpen,
  flashId,
  onEntryChanged,
  canWrite,
  wandbLinks,
  metrics,
}: {
  rows: LedgerRow[];
  /** Which metrics the columns show, with their directions. */
  metrics: MetricSet;
  /** Owner mode: show the dictation and Fix it boxes. The server checks again on every write. */
  canWrite: boolean;
  wandbLinks: boolean;
  initialEntries: Record<string, SavedEntry>;
  /** Id of the expanded run. Lifted so insights can open a run. */
  open: string | null;
  onOpenChange: (id: string | null) => void;
  /** Run just jumped to from an insight; its row gets a brief highlight. */
  flashId: string | null;
  /** Called after an entry is written or fixed, so insights can watch for their rebuild. */
  onEntryChanged: (runId: string) => void;
}) {
  const [entries, setEntries] = useState(initialEntries);
  // The version a fix just replaced, kept briefly so the card can highlight what changed.
  const [replaced, setReplaced] = useState<Record<string, SavedEntry>>({});
  const router = useRouter();

  function onFixed(runId: string, saved: SavedEntry) {
    const before = entries[runId];
    setEntries((prev) => ({ ...prev, [runId]: saved }));
    setReplaced((prev) => ({ ...prev, [runId]: before }));
    onEntryChanged(runId);
    setTimeout(() => {
      setReplaced(({ [runId]: _done, ...rest }) => (void _done, rest));
    }, 4500);
  }
  const runNumber = new Map(rows.map((r) => [r.id, r.n]));

  /** This run against the best earlier run, on the main metric. */
  function vsBest(row: LedgerRow): VsBest | null {
    const v = row.primary.value;
    if (v === null || !row.bestBefore) return null;
    const delta = v - row.bestBefore.value;
    return { n: row.bestBefore.n, metric: metrics.primary.key, delta, improved: improved(metrics.primary, delta) };
  }

  return (
    <Table className="md:min-w-[720px]">
      <TableHeader>
        <TableRow className="border-b-2 border-graphite/70 hover:bg-transparent">
          <TableHead className="hidden w-12 pl-4 text-note font-medium text-pencil sm:table-cell">No.</TableHead>
          <TableHead className="pl-3 text-note font-medium text-pencil sm:pl-2">Run</TableHead>
          <TableHead className="hidden text-note font-medium text-pencil md:table-cell">State</TableHead>
          <TableHead className="hidden text-note font-medium text-pencil md:table-cell">Started (IST)</TableHead>
          <TableHead className={cn("py-2 font-mono text-meta font-semibold text-graphite", !metrics.secondary && "pr-3 sm:pr-4")}>
            {metrics.primary.key}
            <span className="block font-sans text-meta font-normal text-pencil">
              {metrics.primary.higherIsBetter ? "higher" : "lower"} is better · vs previous run
            </span>
          </TableHead>
          {metrics.secondary && (
            <TableHead className="py-2 pr-3 font-mono sm:pr-4 text-meta font-semibold text-graphite">
              {metrics.secondary.key}
              <span className="block font-sans text-meta font-normal text-pencil">
                {metrics.secondary.higherIsBetter ? "higher" : "lower"} is better · vs previous run
              </span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isOpen = open === row.id;
          return (
            <Fragment key={row.id}>
              <TableRow
                id={`run-row-${row.id}`}
                className={cn(
                  "scroll-mt-4 border-grid-major/80 hover:bg-paper-raised/70",
                  isOpen && "bg-paper-raised/80 hover:bg-paper-raised/80",
                  flashId === row.id && "run-flash",
                )}
              >
                <TableCell className="hidden py-3 pl-4 font-mono text-meta text-pencil tabular-nums sm:table-cell">{row.n}</TableCell>
                <TableCell className="py-1.5 pl-3 sm:pl-2">
                  {/* The whole cell (name, plus state and time on phones) is one 44px-tall target. */}
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? `run-${row.id}` : undefined}
                    id={`run-name-${row.id}`}
                    className="group flex min-h-11 w-full max-w-[10rem] flex-col justify-center rounded-sm py-1 text-left font-medium sm:max-w-[22rem]"
                  >
                    <span className="flex min-w-0 max-w-full items-start gap-1.5 sm:items-center">
                      <ChevronRight
                        className={cn(
                          "mt-1 size-3.5 shrink-0 text-pencil motion-safe:transition-transform sm:mt-0",
                          isOpen && "rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 break-words group-hover:underline group-hover:decoration-ballpoint group-hover:underline-offset-4 sm:truncate">
                        {breakable(row.name)}
                      </span>
                      {entries[row.id] && (
                        <NotebookPen className="mt-1 size-3.5 shrink-0 text-ballpoint sm:mt-0" role="img" aria-label="Has an entry" />
                      )}
                    </span>
                    <span className="mt-0.5 block pl-5 font-mono text-meta font-normal text-pencil md:hidden">
                      <span className="block whitespace-nowrap">
                        <span className="sm:hidden">run {row.n} · </span>
                        {row.state}
                      </span>
                      <span className="block whitespace-nowrap">{row.started}</span>
                    </span>
                  </button>
                </TableCell>
                <TableCell className="hidden py-3 md:table-cell">
                  <StateMark state={row.state} />
                </TableCell>
                <TableCell className="hidden py-3 text-note text-pencil md:table-cell">{row.started}</TableCell>
                <TableCell className="py-3">
                  <span className="flex flex-col items-start gap-0.5 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2">
                    <span className={cn("relative inline-block", row.isBest && "mr-2")}>
                      <Value value={row.primary.value} />
                      {row.isBest && <PenLoop />}
                    </span>
                    <Delta cell={row.primary} />
                    {row.isBest && (
                      <span className="pen-note ml-1 hidden font-hand text-hand leading-none whitespace-nowrap text-ballpoint sm:inline-block">
                        ← best so far
                      </span>
                    )}
                  </span>
                </TableCell>
                {row.secondary && (
                  <TableCell className="py-3 pr-3 sm:pr-4">
                    <span className="flex flex-col items-start gap-0.5 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2">
                      <Value value={row.secondary.value} />
                      <Delta cell={row.secondary} />
                    </span>
                  </TableCell>
                )}
              </TableRow>
              {isOpen && (
                <TableRow id={`run-${row.id}`} className="border-grid-major/80 bg-paper-raised/80 hover:bg-paper-raised/80">
                  <TableCell colSpan={6} className="px-4 pt-2 pb-6 whitespace-normal">
                    <div
                      role="region"
                      aria-labelledby={`run-name-${row.id}`}
                      className="sticky left-4 w-[calc(100cqw-2rem)] sm:pl-6"
                    >
                    <div>
                      {entries[row.id] ? (
                        <>
                        <EntryCard
                          key={`${entries[row.id].id}-${entries[row.id].fix_count}`}
                          saved={entries[row.id]}
                          previous={replaced[row.id] ?? null}
                          runNumber={row.n}
                          vsBest={vsBest(row)}
                          prevRunNumber={
                            entries[row.id].entry.prev_run
                              ? (runNumber.get(entries[row.id].entry.prev_run!.id) ?? null)
                              : null
                          }
                        />
                        {canWrite && <FixBox runId={row.id} onFixed={(saved) => onFixed(row.id, saved)} />}
                        </>
                      ) : !canWrite ? (
                        <p className="font-hand text-lg text-pencil">No entry for this run yet.</p>
                      ) : (
                        <EntryComposer
                          runId={row.id}
                          onSaved={(saved) => {
                            setEntries((prev) => ({ ...prev, [row.id]: saved }));
                            onEntryChanged(row.id);
                            router.refresh(); // update the header counts
                          }}
                        />
                      )}
                    </div>
                    {!entries[row.id] && (
                      <div className="mt-5">
                        <ConfigDiff config={row.config} prev={row.prevConfig} prevN={row.n - 1} />
                      </div>
                    )}
                    <details className="mt-4">
                      <summary className="tap w-fit cursor-pointer rounded-sm text-note text-ballpoint">
                        W&B details: full config and summary
                      </summary>
                      <div className="mt-3 grid gap-6 sm:grid-cols-2">
                        <KeyValues title="Config" data={row.config} />
                        <KeyValues title="Summary" data={row.summary} />
                      </div>
                    </details>
                    <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-note">
                      {wandbLinks && (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="tap rounded-sm text-ballpoint underline underline-offset-4"
                        >
                          Open run {row.id} in W&B
                          <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-2px]" aria-hidden />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(null);
                          document.getElementById(`run-name-${row.id}`)?.focus();
                        }}
                        className="tap rounded-sm text-pencil underline underline-offset-4"
                      >
                        Close run {row.n}
                      </button>
                    </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
