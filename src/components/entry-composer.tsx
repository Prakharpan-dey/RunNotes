"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SavedEntry } from "@/lib/entry-schema";
import { useApiFetch } from "@/components/api-context";

/** The "What happened?" box. Posts to /api/entry for the journal, or another endpoint for the demo. */
export function EntryComposer({
  runId,
  onSaved,
  endpoint = "/api/entry",
  placeholder = "Hold Fn and talk it through",
  buttonLabel = "Write entry",
  pendingLabel = "Writing entry…",
  helper = "What you changed, what you saw, what you’ll try next. Ramble; it gets cleaned up.",
}: {
  runId: string;
  onSaved: (entry: SavedEntry, response: Record<string, unknown>) => void;
  endpoint?: string;
  placeholder?: string;
  buttonLabel?: string;
  pendingLabel?: string;
  helper?: string;
}) {
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; limited: boolean } | null>(null);
  const id = useId();
  const apiFetch = useApiFetch();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: body.error ?? `Request failed (${res.status}).`, limited: !!body.limited });
        return;
      }
      onSaved(body.entry as SavedEntry, body);
    } catch {
      setError({ message: "Couldn’t reach the server. Check your connection and try again.", limited: false });
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
        placeholder={placeholder}
        disabled={pending}
        rows={7}
        className="mt-2 min-h-44 resize-y rounded-sm border-graphite/40 bg-paper-raised px-4 py-3 text-[15px] leading-relaxed placeholder:font-hand placeholder:text-lg placeholder:text-pencil/70 focus-visible:border-ballpoint focus-visible:ring-ballpoint/20 md:text-[15px]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={pending || !notes.trim()} className="h-9 rounded-sm px-4">
          {pending ? pendingLabel : buttonLabel}
        </Button>
        {error ? (
          <p role="alert" className={cn("max-w-prose text-sm", error.limited ? "text-ochre" : "text-correction")}>
            {error.message}
          </p>
        ) : (
          <p className="text-[12px] text-pencil">{helper}</p>
        )}
      </div>
    </form>
  );
}
