"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SavedEntry } from "@/lib/entry-schema";
import { useApiFetch } from "@/components/api-context";

export function FixBox({ runId, onFixed }: { runId: string; onFixed: (entry: SavedEntry) => void }) {
  const [correction, setCorrection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
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
    <form onSubmit={submit} className="mt-3 max-w-3xl">
      <label htmlFor={id} className="font-display text-base font-extrabold tracking-wide uppercase">
        Fix it
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start">
        <Textarea
          id={id}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          placeholder="Say what’s wrong, like no wait, it was twenty steps"
          disabled={pending}
          rows={2}
          className="min-h-16 flex-1 resize-y rounded-sm border-graphite/40 bg-paper-raised px-3 py-2 text-[14px] placeholder:font-hand placeholder:text-[16px] placeholder:text-pencil/70 focus-visible:border-ballpoint focus-visible:ring-ballpoint/20 md:text-[14px]"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !correction.trim()}
          className="h-9 shrink-0 rounded-sm border-graphite/60 bg-transparent px-4"
        >
          {pending ? "Applying fix…" : "Apply fix"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-correction">
          {error}
        </p>
      )}
    </form>
  );
}
