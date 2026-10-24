"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

/** Small footer control: unlock owner mode with the passcode, or leave it. */
export function OwnerFooter({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const id = useId();

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setPasscode("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t unlock.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    await fetch("/api/owner", { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  return (
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12px] text-pencil">
      <p>RunNotes · an experiment journal you fill in by talking</p>
      {isOwner ? (
        <p className="flex items-center gap-3">
          <span className="font-mono text-ballpoint">Owner mode</span>
          <button type="button" onClick={signOut} className="rounded-sm underline underline-offset-4">
            Sign out
          </button>
        </p>
      ) : open ? (
        <form onSubmit={unlock} className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="sr-only">
            Owner passcode
          </label>
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            className="h-7 w-36 rounded-sm border border-graphite/40 bg-paper-raised px-2 font-mono text-[12px] text-graphite"
          />
          <button
            type="submit"
            disabled={pending || !passcode}
            className="h-7 rounded-sm border border-graphite/60 px-2.5 text-graphite disabled:opacity-50"
          >
            {pending ? "Unlocking…" : "Unlock"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-sm underline underline-offset-4">
            Cancel
          </button>
          {error && (
            <span role="alert" className="w-full text-correction">
              {error}
            </span>
          )}
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="rounded-sm underline underline-offset-4">
          Owner
        </button>
      )}
    </footer>
  );
}
