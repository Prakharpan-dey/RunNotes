"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SavedEntry } from "@/lib/entry-schema";

export function EntryComposer({ runId, onSaved }: { runId: string; onSaved: (entry: SavedEntry) => void }) {
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      onSaved(body.entry as SavedEntry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write the entry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl">
      <label htmlFor={id} className="font-display text-2xl font-extrabold tracking-tight">
        What happened?
      </label>
      <Textarea
        id={id}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Hold Fn and talk it through"
        disabled={pending}
        rows={7}
        className="mt-2 min-h-44 resize-y rounded-sm border-graphite/40 bg-paper-raised px-4 py-3 text-[15px] leading-relaxed placeholder:font-hand placeholder:text-lg placeholder:text-pencil/70 focus-visible:border-ballpoint focus-visible:ring-ballpoint/20 md:text-[15px]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={pending || !notes.trim()} className="h-9 rounded-sm px-4">
          {pending ? "Writing entry…" : "Write entry"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-correction">
            {error}
          </p>
        ) : (
          <p className="text-[12px] text-pencil">
            What you changed, what you saw, what you&apos;ll try next. Ramble; it gets cleaned up.
          </p>
        )}
      </div>
    </form>
  );
}
