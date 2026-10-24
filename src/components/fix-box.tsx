"use client";

import { useId, useState } from "react";
import type { SavedEntry } from "@/lib/entry-schema";
import { useApiFetch } from "@/components/api-context";

export function FixBox({ runId, onFixed }: { runId: string; onFixed: (entry: SavedEntry) => void }) {
  const [correction, setCorrection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const apiFetch = useApiFetch();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!correction.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch("/api/entry/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, correction }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setCorrection("");
      onFixed(body.entry as SavedEntry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the fix.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-3xl">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <label htmlFor={id} className="font-display text-lg font-extrabold">
          Fix it
        </label>
        <span id={hintId} className="text-note text-pencil">
          Hold Fn and say what’s wrong, like “no wait, it was twenty steps”
          <span className="hidden sm:inline"> · Ctrl+Enter to apply</span>
        </span>
      </p>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          id={id}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          placeholder="Your correction…"
          disabled={pending}
          rows={1}
          className="field-sizing-content min-h-11 flex-1 resize-none border-0 border-b-2 border-graphite/40 bg-transparent px-0 py-1.5 font-hand text-hand leading-snug text-graphite placeholder:text-pencil focus-visible:border-ballpoint disabled:opacity-60"
        />
        {/* Inked like the verdict stamp, upright: the one action on this line. */}
        <button
          type="submit"
          disabled={pending || !correction.trim()}
          className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-sm border-2 border-ballpoint px-4 font-display text-base font-bold tracking-wide text-ballpoint transition-colors hover:bg-ballpoint hover:text-paper disabled:cursor-default disabled:border-graphite/25 disabled:bg-transparent disabled:text-pencil sm:h-9 sm:self-end"
        >
          {pending && <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />}
          {pending ? "Applying fix…" : "Apply fix"}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-correction">
          {error}
        </p>
      )}
    </form>
  );
}
