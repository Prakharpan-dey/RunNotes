import { cn } from "@/lib/utils";
import { diffWords } from "@/lib/word-diff";
import type { SavedEntry, Verdict } from "@/lib/entry-schema";

const VERDICT_STYLES: Record<Verdict, string> = {
  keep: "border-ballpoint text-ballpoint",
  discard: "border-correction text-correction",
  inconclusive: "border-ochre text-ochre",
};

/** Rubber stamp, as if the verdict was inked onto the page. */
function VerdictStamp({ verdict, changed }: { verdict: Verdict; changed: boolean }) {
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

function List({ title, items, before }: { title: string; items: string[]; before: string[] | null }) {
  if (items.length === 0) return null;
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 font-display text-sm font-bold tracking-wide text-pencil uppercase">{title}</h4>
      <ul className="space-y-1 text-[14px] leading-snug">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-pencil" aria-hidden>
              –
            </span>
            <span className="min-w-0">
              <Marked on={!!before && !before.includes(item)}>{item}</Marked>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `previous` is the version this one replaced, passed right after a fix so the
 * parts that changed get a highlighter swipe. Leave it null otherwise.
 */
export function EntryCard({
  saved,
  previous,
  prevRunNumber,
  demo = false,
}: {
  saved: SavedEntry;
  previous: SavedEntry | null;
  prevRunNumber: number | null;
  /** A "Try it yourself" entry: labelled as not saved. */
  demo?: boolean;
}) {
  const { entry } = saved;
  const old = previous?.entry ?? null;
  const notesChanged = !!previous && previous.raw_notes !== saved.raw_notes;

  return (
    <article
      className={cn(
        "relative border bg-paper-raised py-5 pr-5 pl-7 shadow-[3px_3px_0_0_rgb(35_41_31/0.08)]",
        demo ? "border-dashed border-graphite/50" : "border-graphite/40",
      )}
    >
      {/* Margin rule down the left edge of a notebook page */}
      <span className="absolute inset-y-0 left-4 w-px bg-correction/50" aria-hidden />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {demo ? (
            <p className="w-fit rounded-sm border border-ochre px-1.5 py-px font-mono text-[11px] font-semibold tracking-wide text-ochre uppercase">
              Demo entry · not saved
            </p>
          ) : (
            <p className="font-mono text-[11px] text-pencil">
              Entry{prevRunNumber ? ` · compared with run ${prevRunNumber}` : " · first run"}
            </p>
          )}
          <h3 className="mt-1 font-display text-3xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-4xl">
            <Marked on={!!old && old.title !== entry.title}>{entry.title}</Marked>
          </h3>
        </div>
        <VerdictStamp verdict={entry.verdict} changed={!!old && old.verdict !== entry.verdict} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[12px]">
        {entry.metrics.map((m) => (
          <div key={m.key} className="flex items-baseline gap-2">
            <dt className="text-pencil">{m.key}</dt>
            <dd className="tabular-nums">
              {m.value === null ? "—" : m.value.toFixed(3)}
              {m.delta !== null && (
                <span
                  className={cn(
                    "ml-1.5 text-[11px]",
                    m.improved === true && "text-ballpoint",
                    m.improved === false && "text-correction",
                    m.improved === null && "text-pencil",
                  )}
                >
                  {m.delta > 0 ? "+" : m.delta < 0 ? "−" : "±"}
                  {Math.abs(m.delta).toFixed(3)}
                </span>
              )}
            </dd>
          </div>
        ))}
        <p className="text-[11px] text-pencil">numbers from W&B</p>
      </dl>

      {entry.hypothesis && (
        <p className="mt-4 max-w-prose text-[15px] leading-snug">
          <span className="font-display text-sm font-bold tracking-wide text-pencil uppercase">Hypothesis </span>
          <Marked on={!!old && old.hypothesis !== entry.hypothesis}>{entry.hypothesis}</Marked>
        </p>
      )}

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <List title="What changed" items={entry.changes} before={old?.changes ?? null} />
        <List title="What I saw" items={entry.observations} before={old?.observations ?? null} />
        <List title="Next" items={entry.next_steps} before={old?.next_steps ?? null} />
      </div>

      {entry.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 font-mono text-[11px] text-pencil">
          {entry.tags.map((t) => (
            <li key={t}>
              <Marked on={!!old && !old.tags.includes(t)}>#{t}</Marked>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-4 border-t border-dashed border-graphite/25 pt-3 text-[12px] text-pencil">
        <p>
          {demo
            ? "Written just now from your notes. Nothing was saved to the journal."
            : `Written ${saved.created_label} IST from your spoken notes`}
          {saved.updated_label &&
            ` · fixed ${saved.fix_count === 1 ? "once" : `${saved.fix_count} times`}, last at ${saved.updated_label}`}
        </p>
        <details className="mt-2" open={notesChanged || undefined}>
          <summary className="w-fit cursor-pointer rounded-sm text-ballpoint">What I said</summary>
          <p className="mt-2 max-w-prose font-hand text-[16px] leading-snug whitespace-pre-wrap text-graphite">
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
          </p>
        </details>
      </footer>
    </article>
  );
}
