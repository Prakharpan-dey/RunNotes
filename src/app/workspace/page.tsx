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
      <PageHeader />
      <ModeTabs active="workspace" />

      {(connection === undefined || (connection && !current)) && (
        <p className="py-10 text-sm text-pencil">Opening your journal…</p>
      )}

      {connection === null && (
        <section className="max-w-3xl border-2 border-graphite/80 bg-paper/85 px-4 py-6 shadow-[4px_4px_0_0_rgb(35_41_31/0.12)] sm:px-6">
          <h1 className="font-display text-4xl leading-none font-extrabold tracking-tight">Use RunNotes on your own runs</h1>
          <p className="mt-3 max-w-prose text-[15px] leading-snug">
            Connect a Weights &amp; Biases project and you get the full journal: dictate an entry after each run, fix it by
            voice, and see which changes actually moved your score. It&apos;s your own workspace, separate from my journal.
          </p>
          <Link
            href="/connect"
            className="mt-5 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Connect your W&amp;B project
          </Link>
          <p className="mt-3 text-[12px] text-pencil">You&apos;ll need a W&amp;B API key. A Gemini key is optional.</p>
        </section>
      )}

      {current?.kind === "error" && (
        <section className="max-w-3xl border-2 border-graphite/80 bg-paper/85 px-4 py-6 sm:px-6">
          <p className="font-hand text-xl text-correction">Couldn&apos;t open your journal.</p>
          <p role="alert" className="mt-1 max-w-prose text-sm">
            {current.message}
          </p>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
            <Link href="/connect" className="text-ballpoint underline underline-offset-4">
              Check your connection
            </Link>
            <button type="button" onClick={leave} className="text-pencil underline underline-offset-4">
              Disconnect
            </button>
          </p>
        </section>
      )}

      {current?.kind === "ready" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px]">
            <p className="min-w-0">
              <span className="font-display text-sm font-bold tracking-wide uppercase">Your project</span>{" "}
              <span className="font-mono text-[12px] text-pencil">
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
                    <Link href="/connect" className="text-ballpoint underline underline-offset-4">
                      add a key
                    </Link>
                  </>
                )}
              </span>
              <Link href="/connect" className="text-ballpoint underline underline-offset-4">
                Change settings
              </Link>
              <button type="button" onClick={leave} className="rounded-sm border border-graphite/50 px-2.5 py-1">
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
            />
          </ApiProvider>
          <p className="mt-6 text-[12px] text-pencil">
            Your workspace is tied to this browser. Anyone with its ID and your W&amp;B key could open it, so don&apos;t share
            either.
          </p>
        </>
      )}
    </main>
  );
}
