import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatIst } from "@/lib/ledger";
import type { Entry, HistoryItem, SavedEntry } from "@/lib/entry-schema";

let client: SupabaseClient | null = null;

/** The owner's journal. Visitor workspaces are random UUIDs. */
export const OWNER_WORKSPACE = "owner";

export class DbError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new DbError("Supabase isn't configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.");
  }
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** A full row. history and updated_at are missing until 002_entry_history.sql has run. */
export type EntryRow = {
  id: string;
  run_id: string;
  raw_notes: string;
  entry: Entry;
  created_at: string;
  updated_at?: string | null;
  history?: HistoryItem[];
  workspace?: string;
};

function toSaved(row: EntryRow): SavedEntry {
  return {
    id: row.id,
    run_id: row.run_id,
    raw_notes: row.raw_notes,
    entry: row.entry,
    created_at: row.created_at,
    created_label: formatIst(row.created_at),
    updated_label: row.updated_at ? formatIst(row.updated_at) : null,
    fix_count: row.history?.length ?? 0,
  };
}

export function explain(message: string): string {
  if (/relation .*entries.* does not exist|Could not find the table/i.test(message)) {
    return "The entries table doesn't exist yet. Run supabase/entries.sql in the Supabase SQL editor.";
  }
  if (/workspace/i.test(message)) {
    return "The database isn't set up for workspaces yet. Run supabase/005_workspaces.sql in the Supabase SQL editor.";
  }
  if (/history|updated_at/i.test(message)) {
    return "The entries table is missing the history column. Run supabase/002_entry_history.sql in the Supabase SQL editor.";
  }
  return `Supabase error: ${message}`;
}

export async function getEntries(workspace: string): Promise<Record<string, SavedEntry>> {
  const { data, error } = await db()
    .from("entries")
    .select("*")
    .eq("workspace", workspace)
    .order("created_at", { ascending: false });
  if (error) throw new DbError(explain(error.message));
  const byRun: Record<string, SavedEntry> = {};
  for (const row of data as EntryRow[]) byRun[row.run_id] ??= toSaved(row);
  return byRun;
}

export async function getEntryRow(workspace: string, runId: string): Promise<EntryRow | null> {
  const { data, error } = await db()
    .from("entries")
    .select("*")
    .eq("workspace", workspace)
    .eq("run_id", runId)
    .maybeSingle();
  if (error) throw new DbError(explain(error.message));
  return data as EntryRow | null;
}

export async function saveEntry(workspace: string, runId: string, rawNotes: string, entry: Entry): Promise<SavedEntry> {
  const { data, error } = await db()
    .from("entries")
    .upsert(
      { workspace, run_id: runId, raw_notes: rawNotes, entry, created_at: new Date().toISOString() },
      { onConflict: "workspace,run_id" },
    )
    .select("*")
    .single();
  if (error) throw new DbError(explain(error.message));
  return toSaved(data as EntryRow);
}

/** Replaces an entry with its fixed version and appends the old one to history. */
export async function applyFix(row: EntryRow, rawNotes: string, entry: Entry, correction: string): Promise<SavedEntry> {
  if (!("history" in row)) throw new DbError(explain("missing history column"));
  const now = new Date().toISOString();
  const previous: HistoryItem = {
    raw_notes: row.raw_notes,
    entry: row.entry,
    saved_at: row.updated_at ?? row.created_at,
    replaced_at: now,
    correction,
  };
  const { data, error } = await db()
    .from("entries")
    .update({ raw_notes: rawNotes, entry, history: [...(row.history ?? []), previous], updated_at: now })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new DbError(explain(error.message));
  return toSaved(data as EntryRow);
}

/** Every entry row in a workspace, for building insights. */
export async function getEntryRows(workspace: string): Promise<EntryRow[]> {
  const { data, error } = await db().from("entries").select("*").eq("workspace", workspace);
  if (error) throw new DbError(explain(error.message));
  return data as EntryRow[];
}
