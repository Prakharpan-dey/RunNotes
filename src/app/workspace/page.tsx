"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiProvider } from "@/components/api-context";
import { JournalSheet } from "@/components/journal-sheet";
import { ModeTabs, PageHeader } from "@/components/mode-tabs";
import {
  connectionSnapshot,
  disconnect,
  serverConnectionSnapshot,
  subscribeConnection,
  workspaceHeaders,
  workspaceIdFor,
  type Connection,
} from "@/lib/client-workspace";
import type { SavedEntry } from "@/lib/entry-schema";
import type { SavedInsights } from "@/lib/insights-schema";
import type { LedgerRow } from "@/lib/ledger";
import type { MetricSet } from "@/lib/metrics";

type Journal = {
  entity: string;
  project: string;
  metrics: MetricSet;
  rows: LedgerRow[];
  entries: Record<string, SavedEntry>;
  insights: SavedInsights | null;
  notice: string | null;
  insightsError: string | null;
  ownGeminiKey: boolean;
  aiLimit: number;
};

type Loaded =
  | { for: Connection; kind: "ready"; journal: Journal; workspaceId: string }
  | { for: Connection; kind: "error"; message: string };

export default function WorkspacePage() {
  const router = useRouter();
  // The visitor's keys from this tab's sessionStorage; undefined while rendering on the server.
  const connection = useSyncExternalStore(subscribeConnection, connectionSnapshot, serverConnectionSnapshot);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!connection) return;
    const workspaceId = workspaceIdFor(connection.entity, connection.project);
    let cancelled = false;
    fetch("/api/workspace/journal", { headers: workspaceHeaders(connection, workspaceId), cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 404) {
          // The workspace isn't set up for this project yet: finish connecting.
          router.replace("/connect");
          return;
        }
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
        setLoaded({ for: connection, kind: "ready", journal: body as Journal, workspaceId });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded({ for: connection, kind: "error", message: err instanceof Error ? err.message : "Couldn't load your journal." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connection, router]);

  const current = connection && loaded?.for === connection ? loaded : null;
  const headers = useCallback(
    () => (current?.kind === "ready" ? workspaceHeaders(current.for, current.workspaceId) : ({} as Record<string, string>)),
    [current],
  );

  function leave() {
    disconnect();
    router.push("/");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader as={current?.kind === "ready" ? "h1" : "p"} />
      <ModeTabs active="workspace" />

      {(connection === undefined || (connection && !current)) && (
        <p className="py-10 text-sm text-pencil">Opening your journal…</p>
      )}

      {connection === null && (
        <section className="grid items-center gap-10 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <h1 className="max-w-md font-display text-5xl leading-[0.95] font-extrabold tracking-tight text-balance">
              Use RunNotes on your own runs
            </h1>
            <p className="mt-4 max-w-prose text-body leading-snug">
              Connect a Weights &amp; Biases project and you get the full journal: dictate an entry after each run, fix it
              by voice, and see which changes actually moved your score. It&apos;s your own workspace, separate from my
              journal.
            </p>
            <Link
              href="/connect"
              className="mt-6 inline-flex h-11 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground sm:h-10"
            >
              Connect your W&amp;B project
            </Link>
            <p className="mt-3 text-meta text-pencil">You&apos;ll need a W&amp;B API key. A Gemini key is optional.</p>
          </div>
          <SamplePage />
        </section>
      )}

      {current?.kind === "error" && (
        <section className="max-w-3xl border-2 border-graphite/80 bg-paper/85 px-4 py-6 sm:px-6">
          <p className="font-hand text-xl text-correction">Couldn&apos;t open your journal.</p>
          <p role="alert" className="mt-1 max-w-prose text-sm">
            {current.message}
          </p>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-note">
            <Link href="/connect" className="tap text-ballpoint underline underline-offset-4">
              Check your connection
            </Link>
            <button type="button" onClick={leave} className="tap text-pencil underline underline-offset-4">
              Disconnect
            </button>
          </p>
        </section>
      )}

      {current?.kind === "ready" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-note">
            <p className="min-w-0">
              <span className="font-display text-base font-bold">Your project</span>{" "}
              <span className="font-mono text-meta text-pencil">
                · {current.journal.entity}/{current.journal.project}
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-pencil">
                {current.journal.ownGeminiKey ? (
                  "Using your Gemini key"
                ) : (
                  <>
                    Free tier: {current.journal.aiLimit} AI calls a day ·{" "}
                    <Link href="/connect" className="tap text-ballpoint underline underline-offset-4">
                      add a key
                    </Link>
                  </>
                )}
              </span>
              <Link href="/connect" className="tap text-ballpoint underline underline-offset-4">
                Change settings
              </Link>
              <button type="button" onClick={leave} className="min-h-11 rounded-sm border border-graphite/50 px-3 sm:min-h-8">
                Disconnect
              </button>
            </p>
          </div>
          <ApiProvider headers={headers}>
            <JournalSheet
              entity={current.journal.entity}
              project={current.journal.project}
              metrics={current.journal.metrics}
              rows={current.journal.rows}
              entries={current.journal.entries}
              insights={current.journal.insights}
              insightsError={current.journal.insightsError}
              notice={current.journal.notice ?? undefined}
              canWrite
              wandbLinks
            />
          </ApiProvider>
          <p className="mt-6 text-meta text-pencil">
            Your workspace is tied to this browser. Anyone with its ID and your W&amp;B key could open it, so don&apos;t share
            either.
          </p>
        </>
      )}
    </main>
  );
}

/** A blank pad page with one run already written up: what a connected journal looks like. */
function SamplePage() {
  const rows = [
    { n: 3, name: "baseline-ridge", value: "0.812", delta: null },
    { n: 4, name: "add-text-features", value: "0.701", delta: "−0.111" },
    { n: 5, name: "bigger-batch", value: "0.705", delta: "+0.004" },
  ];
  return (
    <figure aria-hidden className="relative rotate-1 border-2 border-graphite/50 bg-paper-raised/80 px-5 py-4 shadow-sheet select-none">
      <div className="flex items-baseline justify-between border-b-2 border-graphite/40 pb-2">
        <p className="font-display text-2xl font-extrabold tracking-tight">your-project</p>
        <p className="font-mono text-meta text-pencil">3 runs</p>
      </div>
      <ul className="divide-y divide-grid-major/80 font-mono text-meta">
        {rows.map((r) => (
          <li key={r.n} className="flex items-baseline gap-3 py-2">
            <span className="w-4 text-pencil">{r.n}</span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="tabular-nums">{r.value}</span>
            <span className={`w-14 text-right tabular-nums ${r.delta?.startsWith("−") ? "text-ballpoint" : "text-correction"}`}>
              {r.delta ?? ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="relative mt-3 border border-graphite/30 bg-paper py-3 pr-3 pl-6">
        <span className="absolute inset-y-0 left-3 w-px bg-correction/50" />
        <p className="font-display text-lg leading-tight font-extrabold">Adding text features set a new best</p>
        <p className="mt-1 font-hand text-base leading-snug text-pencil">
          “Swapped in the transcript features, rmse dropped a lot. Try a bigger model next.”
        </p>
      </div>
      <figcaption className="absolute -bottom-7 left-2 font-hand text-base text-pencil">← this, for every run you log</figcaption>
    </figure>
  );
}
