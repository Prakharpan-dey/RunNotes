"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedgerRow, MetricCell } from "@/lib/ledger";
import type { SavedEntry } from "@/lib/entry-schema";
import { EntryCard } from "@/components/entry-card";
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
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px font-mono text-[11px] lowercase",
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
        "font-mono text-[11px]",
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
  if (value === null) return <span className="font-mono text-pencil/60">—</span>;
  return <span className="font-mono text-[13px] tabular-nums">{value.toFixed(3)}</span>;
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

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toPrecision(6));
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function KeyValues({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="min-w-0">
      <h3 className="mb-2 font-display text-sm font-bold tracking-wide text-pencil uppercase">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-pencil">Nothing logged.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
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
}: {
  rows: LedgerRow[];
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

  return (
    <Table className="md:min-w-[720px]">
      <TableHeader>
        <TableRow className="border-b-2 border-graphite/70 hover:bg-transparent">
          <TableHead className="hidden w-12 pl-4 font-display sm:table-cell text-sm font-bold tracking-wide text-pencil uppercase">No.</TableHead>
          <TableHead className="pl-3 font-display text-sm font-bold tracking-wide text-pencil uppercase sm:pl-2">Run</TableHead>
          <TableHead className="hidden font-display text-sm font-bold tracking-wide text-pencil uppercase md:table-cell">State</TableHead>
          <TableHead className="hidden font-display text-sm font-bold tracking-wide text-pencil uppercase md:table-cell">Started (IST)</TableHead>
          <TableHead className="py-2 font-mono text-[12px] font-semibold text-graphite">
            val_rmse
            <span className="block font-sans text-[10px] font-normal text-pencil">lower is better</span>
          </TableHead>
          <TableHead className="py-2 pr-3 font-mono sm:pr-4 text-[12px] font-semibold text-graphite">
            val_pearson
            <span className="block font-sans text-[10px] font-normal text-pencil">higher is better</span>
          </TableHead>
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
                <TableCell className="hidden py-3 pl-4 font-mono text-[12px] text-pencil tabular-nums sm:table-cell">{row.n}</TableCell>
                <TableCell className="py-3 pl-3 sm:pl-2">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                    aria-controls={`run-${row.id}`}
                    className="group inline-flex max-w-[7.5rem] items-center sm:max-w-[22rem] gap-1.5 rounded-sm text-left font-medium"
                  >
                    <ChevronRight
                      className={cn("size-3.5 shrink-0 text-pencil transition-transform", isOpen && "rotate-90")}
                      aria-hidden
                    />
                    <span className="truncate group-hover:underline group-hover:decoration-ballpoint group-hover:underline-offset-4">
                      {row.name}
                    </span>
                    {entries[row.id] && (
                      <NotebookPen className="size-3.5 shrink-0 text-ballpoint" aria-label="Has an entry" />
                    )}
                  </button>
                  <span className="mt-1 block pl-5 font-mono text-[11px] whitespace-normal text-pencil md:hidden">
                    <span className="sm:hidden">{row.n}. </span>{row.state} · {row.started}
                  </span>
                </TableCell>
                <TableCell className="hidden py-3 md:table-cell">
                  <StateMark state={row.state} />
                </TableCell>
                <TableCell className="hidden py-3 text-[13px] text-pencil md:table-cell">{row.started}</TableCell>
                <TableCell className="py-3">
                  <span className="flex flex-col items-start gap-0.5 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2">
                    <span className={cn("relative inline-block", row.isBest && "mr-2")}>
                      <Value value={row.rmse.value} />
                      {row.isBest && <PenLoop />}
                    </span>
                    <Delta cell={row.rmse} />
                    {row.isBest && (
                      <span className="pen-note ml-1 hidden sm:inline-block font-hand text-[17px] leading-none text-ballpoint">
                        ← best so far
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="py-3 pr-3 sm:pr-4">
                  <span className="flex flex-col items-start gap-0.5 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2">
                    <Value value={row.pearson.value} />
                    <Delta cell={row.pearson} />
                  </span>
                </TableCell>
              </TableRow>
              {isOpen && (
                <TableRow id={`run-${row.id}`} className="border-grid-major/80 bg-paper-raised/80 hover:bg-paper-raised/80">
                  <TableCell colSpan={6} className="px-4 pt-1 pb-5 whitespace-normal">
                    <div className="grid gap-6 pl-6 sm:grid-cols-2">
                      <KeyValues title="Config" data={row.config} />
                      <KeyValues title="Summary metrics" data={row.summary} />
                    </div>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 ml-6 inline-block rounded-sm text-[13px] text-ballpoint underline underline-offset-4"
                    >
                      Open run {row.id} in W&B ↗
                    </a>
                    <div className="mt-6 sm:pl-6">
                      {entries[row.id] ? (
                        <>
                        <EntryCard
                          key={`${entries[row.id].id}-${entries[row.id].fix_count}`}
                          saved={entries[row.id]}
                          previous={replaced[row.id] ?? null}
                          prevRunNumber={
                            entries[row.id].entry.prev_run
                              ? (runNumber.get(entries[row.id].entry.prev_run!.id) ?? null)
                              : null
                          }
                        />
                        <FixBox runId={row.id} onFixed={(saved) => onFixed(row.id, saved)} />
                        </>
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
