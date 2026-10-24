import { cn } from "@/lib/utils";
import { diffWords } from "@/lib/word-diff";
import type { SavedEntry, Verdict } from "@/lib/entry-schema";

const VERDICT_STYLES: Record<Verdict | "baseline", string> = {
  keep: "border-ballpoint text-ballpoint",
  discard: "border-correction text-correction",
  inconclusive: "border-ochre text-ochre",
  baseline: "border-graphite/70 text-graphite",
};

/** Section labels inside the card: sentence case in the display face. */
const LABEL = "font-display text-base font-bold text-pencil";

/** Rubber stamp, as if the verdict was inked onto the page. */
function VerdictStamp({ verdict, changed }: { verdict: Verdict | "baseline"; changed: boolean }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 -rotate-3 rounded-sm border-2 px-2.5 py-0.5 font-display text-lg leading-tight font-extrabold tracking-[0.12em] uppercase",
        VERDICT_STYLES[verdict],
        changed && "fix-mark",
      )}
    >
      {verdict}
    </span>
  );
}

function Marked({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <span className="fix-mark">{children}</span> : <>{children}</>;
}

function SignedDelta({ delta, improved, muted = false }: { delta: number; improved: boolean | null; muted?: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        muted || improved === null ? "text-pencil" : improved ? "text-ballpoint" : "text-correction",
      )}
    >
      {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
      {Math.abs(delta).toFixed(3)}
      <span className="sr-only">{improved === true ? " (better)" : improved === false ? " (worse)" : ""}</span>
    </span>
  );
}

/** "alpha: null -> 100" from the config diff, drawn as a correction: old struck out, new in ink. */
const CHANGE = /^([\w.\-/]+):\s*(.+?)\s*->\s*(.+)$/;

function shown(v: string): string {
  return v === "null" || v === "undefined" ? "unset" : v.replace(/^"(.*)"$/, "$1");
}

function Item({ text }: { text: string }) {
  const m = CHANGE.exec(text);
  if (!m) return <>{text}</>;
  const [, key, from, to] = m;
  return (
    <span className="font-mono text-note">
      {key} <del className="text-pencil decoration-correction/70">{shown(from)}</del>
      <span className="text-pencil"> → </span>
      <ins className="text-ballpoint no-underline">{shown(to)}</ins>
    </span>
  );
}

/**
 * A line of the page: its label written in the margin, left of the red rule, the way a lab
 * notebook is kept. On a phone the margin folds away and the label sits above.
 */
function Row({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-x-(--gutter) gap-y-1 sm:grid-cols-[var(--margin)_minmax(0,1fr)]", className)}>
      <h4 className={cn(LABEL, "leading-snug sm:pt-px sm:text-right")}>{label}</h4>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function List({ items, before }: { items: string[]; before: string[] | null }) {
  return (
    <ul className="space-y-1 text-body leading-snug">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-pencil" aria-hidden>
            –
          </span>
          <span className="min-w-0">
            <Marked on={!!before && !before.includes(item)}>
              <Item text={item} />
            </Marked>
          </span>
        </li>
      ))}
    </ul>
  );
}

export type VsBest = {
  /** The best earlier run. */
  n: number;
  metric: string;
  delta: number;
  improved: boolean | null;
};

/**
 * `previous` is the version this one replaced, passed right after a fix so the
 * parts that changed get a highlighter swipe. Leave it null otherwise.
 */
export function EntryCard({
  saved,
  previous,
  runNumber = null,
  prevRunNumber,
  vsBest = null,
  demo = false,
}: {
  saved: SavedEntry;
  previous: SavedEntry | null;
  /** This run's number, written in the margin. */
  runNumber?: number | null;
  prevRunNumber: number | null;
  /**
   * This run against the best earlier one, so a verdict that disagrees with the
   * run-to-run deltas still makes sense ("discard": better than run 5, worse than run 4).
   */
  vsBest?: VsBest | null;
  /** A "Try it yourself" entry: labelled as not saved. */
  demo?: boolean;
}) {
  const { entry } = saved;
  const old = previous?.entry ?? null;
  const notesChanged = !!previous && previous.raw_notes !== saved.raw_notes;
  const first = prevRunNumber === null;
  // A first run is the reference point; "inconclusive" is the wrong word for it.
  const stamp = first && entry.verdict === "inconclusive" ? "baseline" : entry.verdict;
  const fixes = saved.fix_count === 1 ? "once" : saved.fix_count === 2 ? "twice" : `${saved.fix_count} times`;

  return (
    <article
      className={cn(
        "relative space-y-5 border bg-paper px-(--pad) py-5 [--gutter:1.5rem] [--margin:7rem] [--pad:1.25rem]",
        demo ? "border-dashed border-graphite/50" : "border-graphite/40",
      )}
    >
      {/* The page's margin rule: everything left of it is annotation, right of it is the entry. */}
      <span
        className="absolute inset-y-0 left-[calc(var(--pad)+var(--margin)+var(--gutter)/2)] hidden w-px bg-correction/45 sm:block"
        aria-hidden
      />

      <div className="grid gap-x-(--gutter) gap-y-2 sm:grid-cols-[var(--margin)_minmax(0,1fr)]">
        {/* Margin: the run and when it was written, in pencil. */}
        <p className="flex flex-wrap items-baseline gap-x-3 font-hand leading-tight text-pencil sm:block sm:text-right">
          {runNumber !== null && <span className="text-xl text-graphite">Run {runNumber}</span>}
          <span className="text-sm sm:block">{demo ? "just now" : saved.created_label}</span>
          {saved.updated_label && <span className="text-sm sm:block">fixed {fixes}</span>}
        </p>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <h3 className="min-w-0 font-display text-2xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-3xl">
              <Marked on={!!old && old.title !== entry.title}>{entry.title}</Marked>
            </h3>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <VerdictStamp verdict={stamp} changed={!!old && old.verdict !== entry.verdict} />
              {demo && (
                <p className="rounded-sm border border-ochre px-1.5 py-px font-mono text-meta font-semibold tracking-wide whitespace-nowrap text-ochre uppercase">
                  Demo entry · not saved
                </p>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-note">
            <dl className="contents">
              {entry.metrics.map((m) => (
                <div key={m.key} className="flex items-baseline gap-2">
                  <dt className="text-pencil">{m.key}</dt>
                  <dd className="tabular-nums">
                    {m.value === null ? "—" : m.value.toFixed(3)}
                    {m.delta !== null && (
                      <span className="ml-1.5">
                        <SignedDelta delta={m.delta} improved={m.improved} muted={!!vsBest} />
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="font-sans text-meta text-pencil">{first ? "first run" : `change vs run ${prevRunNumber}`}</p>
            {vsBest && (
              <p className="flex items-baseline gap-2 sm:border-l sm:border-graphite/30 sm:pl-4">
                <span className="font-sans text-meta text-pencil">
                  {vsBest.improved === true ? "new best, vs" : "vs best,"} run {vsBest.n}
                </span>
                <SignedDelta delta={vsBest.delta} improved={vsBest.improved} />
              </p>
            )}
          </div>
        </div>
      </div>

      {entry.hypothesis && (
        <Row label="Hypothesis">
          <p className="max-w-[68ch] text-body leading-snug">
            <Marked on={!!old && old.hypothesis !== entry.hypothesis}>{entry.hypothesis}</Marked>
          </p>
        </Row>
      )}
      {entry.changes.length > 0 && (
        <Row label={first ? "Setup" : "Changed"}>
          <List items={entry.changes} before={old?.changes ?? null} />
        </Row>
      )}
      {entry.observations.length > 0 && (
        <Row label="Saw">
          <List items={entry.observations} before={old?.observations ?? null} />
        </Row>
      )}
      {entry.next_steps.length > 0 && (
        <Row label="Next">
          <List items={entry.next_steps} before={old?.next_steps ?? null} />
        </Row>
      )}

      {/* The spoken notes: set for reading, in the body face; handwriting is kept for short quotes. */}
      <Row label="Said">
        <details className="group" open={notesChanged || undefined}>
          <summary className="tap w-fit cursor-pointer list-none rounded-sm text-note text-ballpoint underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show what I said</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <blockquote className="mt-2 max-w-[58ch] text-body leading-relaxed whitespace-pre-wrap text-graphite">
            <span className="-ml-[0.45em] text-pencil" aria-hidden>“</span>
            {notesChanged
              ? diffWords(previous.raw_notes, saved.raw_notes).map((t, i) =>
                  t.added ? (
                    <span key={i} className="fix-mark">
                      {t.text}
                    </span>
                  ) : (
                    t.text
                  ),
                )
              : saved.raw_notes}
            <span className="text-pencil" aria-hidden>”</span>
          </blockquote>
        </details>
      </Row>

      <div className="grid gap-x-(--gutter) sm:grid-cols-[var(--margin)_minmax(0,1fr)]">
        <div className="col-start-2 max-sm:col-start-1">
          {entry.tags.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-meta text-pencil">
              {entry.tags.map((t) => (
                <li key={t}>
                  <Marked on={!!old && !old.tags.includes(t)}>#{t}</Marked>
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta text-pencil">
            {demo
              ? "Written from your notes; nothing was saved to the journal. Numbers from W&B."
              : `Numbers from W&B${saved.updated_label ? ` · last corrected ${saved.updated_label} IST` : ""}`}
          </p>
        </div>
      </div>
    </article>
  );
}
