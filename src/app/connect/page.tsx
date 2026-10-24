"use client";

import { useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModeTabs, PageHeader } from "@/components/mode-tabs";
import {
  guessLowerIsBetter,
  connectionSnapshot,
  serverConnectionSnapshot,
  subscribeConnection,
  saveConnection,
  workspaceHeaders,
  workspaceIdFor,
  type Connection,
} from "@/lib/client-workspace";
import { WORKSPACE_AI_LIMIT } from "@/lib/limits";
import { cn } from "@/lib/utils";

type Found = { runCount: number; metricKeys: string[]; ownGeminiKey: boolean };
type Choice = { key: string; higherIsBetter: boolean };

const inputClass =
  "mt-1 h-11 w-full rounded-sm border border-graphite/40 bg-paper-raised px-3 font-mono text-note text-graphite focus-visible:border-ballpoint sm:h-9";

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-note font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 max-w-prose text-meta text-pencil">{hint}</p>}
    </div>
  );
}

/** Lower / higher is better, as real radio buttons: one Tab stop, arrow keys switch. */
function Direction({ value, onChange, name }: { value: boolean; onChange: (higher: boolean) => void; name: string }) {
  const group = useId();
  return (
    <fieldset className="mt-1 inline-flex rounded-sm border border-graphite/40 p-0.5">
      <legend className="sr-only">{name}: which way is better</legend>
      {[false, true].map((higher) => (
        <label key={String(higher)} className="cursor-pointer">
          <input
            type="radio"
            name={group}
            checked={value === higher}
            onChange={() => onChange(higher)}
            className="peer sr-only"
          />
          <span
            className={cn(
              "inline-flex min-h-11 items-center rounded-sm px-2.5 text-meta peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ballpoint sm:min-h-8",
              value === higher ? "bg-graphite text-paper" : "text-pencil",
            )}
          >
            {higher ? "Higher is better" : "Lower is better"}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export default function ConnectPage() {
  // "Change settings" comes back here with the current connection filled in. The form remounts
  // once the browser's stored connection is known, so its fields start from it.
  const stored = useSyncExternalStore(subscribeConnection, connectionSnapshot, serverConnectionSnapshot);
  return <ConnectForm key={stored === undefined ? "server" : stored ? "stored" : "empty"} initial={stored ?? null} />;
}

function ConnectForm({ initial }: { initial: Connection | null }) {
  const router = useRouter();
  const [wandbKey, setWandbKey] = useState(initial?.wandbKey ?? "");
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  const [geminiKey, setGeminiKey] = useState(initial?.geminiKey ?? "");
  const [found, setFound] = useState<Found | null>(null);
  const [primary, setPrimary] = useState<Choice | null>(null);
  const [secondary, setSecondary] = useState<Choice | null>(null);
  const [pending, setPending] = useState<"check" | "connect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connection = (): Connection => ({
    wandbKey: wandbKey.trim(),
    entity: entity.trim(),
    project: project.trim(),
    geminiKey: geminiKey.trim() || null,
  });

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setPending("check");
    setError(null);
    setFound(null);
    try {
      const res = await fetch("/api/workspace/verify", { method: "POST", headers: workspaceHeaders(connection()) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      const f = body as Found;
      setFound(f);
      const first = f.metricKeys[0];
      setPrimary({ key: first, higherIsBetter: !guessLowerIsBetter(first) });
      setSecondary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the connection.");
    } finally {
      setPending(null);
    }
  }

  async function connect() {
    if (!primary) return;
    setPending("connect");
    setError(null);
    try {
      const c = connection();
      const id = workspaceIdFor(c.entity, c.project);
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workspaceHeaders(c, id) },
        body: JSON.stringify({ primary, secondary }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      saveConnection(c);
      router.push("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.");
      setPending(null);
    }
  }

  const ready = wandbKey.trim() && entity.trim() && project.trim();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader />
      <ModeTabs active="workspace" />

      <section className="pad max-w-3xl border-2 border-graphite/80 px-4 py-6 shadow-sheet sm:px-6">
        <h1 className="font-display text-4xl leading-none font-extrabold tracking-tight">Connect your W&B project</h1>
        <p className="mt-2 max-w-prose text-body leading-snug">
          Use RunNotes on your own runs: talk after each one, fix entries by voice, and see what your runs add up to. Your
          journal is separate from mine.
        </p>

        <p className="mt-3 max-w-prose border-l border-graphite/40 pl-3 text-note text-pencil">
          Your keys stay in this browser tab and are sent only with your own requests. RunNotes never stores them. Closing
          the tab forgets them; your journal stays and comes back when you reconnect.
        </p>

        <form onSubmit={check} className="mt-6 grid gap-4">
          <Field
            label="W&B API key"
            hint={
              <>
                From{" "}
                <a href="https://wandb.ai/authorize" target="_blank" rel="noreferrer" className="tap rounded-sm text-ballpoint underline underline-offset-4">
                  wandb.ai/authorize
                </a>
                .
              </>
            }
          >
            {(id) => (
              <input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={wandbKey}
                onChange={(e) => setWandbKey(e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Entity" hint="Your username or team, as in wandb.ai/entity/project.">
              {(id) => (
                <input id={id} spellCheck={false} value={entity} onChange={(e) => setEntity(e.target.value)} className={inputClass} />
              )}
            </Field>
            <Field label="Project">
              {(id) => (
                <input id={id} spellCheck={false} value={project} onChange={(e) => setProject(e.target.value)} className={inputClass} />
              )}
            </Field>
          </div>
          <Field
            label="Optional: add your own free Gemini key for unlimited use."
            hint={
              <>
                Without it you get {WORKSPACE_AI_LIMIT} free AI calls a day (about 2 entries). Get one at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="tap rounded-sm text-ballpoint underline underline-offset-4">
                  aistudio.google.com/apikey
                </a>
                .
              </>
            }
          >
            {(id) => (
              <input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" disabled={!ready || pending !== null} className="h-11 rounded-sm px-4 sm:h-9">
              {pending === "check" ? "Checking…" : "Check connection"}
            </Button>
            <Link href="/" className="tap text-note text-pencil underline underline-offset-4">
              Back to my journal
            </Link>
          </div>
        </form>

        {found && primary && (
          <div className="mt-6 border-t border-dashed border-graphite/30 pt-5">
            <p className="text-body">
              Found <strong>{found.runCount}</strong> {found.runCount === 1 ? "run" : "runs"} in{" "}
              <span className="font-mono text-note">
                {entity.trim()}/{project.trim()}
              </span>
              {found.ownGeminiKey ? ", and your Gemini key works." : "."}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Main metric" hint="Decides your best run, levers, no-effect results and regressions.">
                {(id) => (
                  <>
                    <select
                      id={id}
                      value={primary.key}
                      onChange={(e) => setPrimary({ key: e.target.value, higherIsBetter: !guessLowerIsBetter(e.target.value) })}
                      className={inputClass}
                    >
                      {found.metricKeys.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <Direction name="Main metric" value={primary.higherIsBetter} onChange={(h) => setPrimary({ ...primary, higherIsBetter: h })} />
                  </>
                )}
              </Field>
              <Field label="Second metric (optional)" hint="Shown alongside, and checked when your notes predict it.">
                {(id) => (
                  <>
                    <select
                      id={id}
                      value={secondary?.key ?? ""}
                      onChange={(e) =>
                        setSecondary(e.target.value ? { key: e.target.value, higherIsBetter: !guessLowerIsBetter(e.target.value) } : null)
                      }
                      className={inputClass}
                    >
                      <option value="">None</option>
                      {found.metricKeys
                        .filter((k) => k !== primary.key)
                        .map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                    </select>
                    {secondary && (
                      <Direction name="Second metric" value={secondary.higherIsBetter} onChange={(h) => setSecondary({ ...secondary, higherIsBetter: h })} />
                    )}
                  </>
                )}
              </Field>
            </div>
            <Button type="button" onClick={connect} disabled={pending !== null} className="mt-5 h-11 rounded-sm px-4 sm:h-9">
              {pending === "connect" ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 max-w-prose text-sm text-correction">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
