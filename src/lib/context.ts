import "server-only";
import { EntryError, redact } from "@/lib/errors";
import { labelFor, OWNER_METRICS, type MetricSet } from "@/lib/metrics";
import { requireOwner } from "@/lib/owner";
import { WORKSPACE_AI_LIMIT } from "@/lib/limits";
import { hitRateLimit } from "@/lib/rate-limit";
import { db, DbError, OWNER_WORKSPACE } from "@/lib/supabase";
import { ownerSource, WANDB_NAME, WandbError, type WandbSource } from "@/lib/wandb";

/**
 * Whose journal a request is about. With no workspace header it's the owner's (server keys,
 * owner cookie for writes). With one, it's a visitor workspace: their W&B key and optional
 * Gemini key come from request headers, held in memory for this request only.
 */
export type JournalContext = {
  workspace: string;
  visitor: boolean;
  source: WandbSource;
  metrics: MetricSet;
  /** A visitor's own Gemini key; null means the server's key. */
  geminiKey: string | null;
};

export const HEADER = {
  workspace: "x-rn-workspace",
  wandbKey: "x-rn-wandb-key",
  entity: "x-rn-wandb-entity",
  project: "x-rn-wandb-project",
  geminiKey: "x-rn-gemini-key",
} as const;

/** Free-tier limits for workspaces on the server's Gemini key, and for database writes. */
export { WORKSPACE_AI_LIMIT } from "@/lib/limits";
const WORKSPACE_WRITE_LIMIT = 100;
const DAY = 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceRow = {
  id: string;
  wandb_entity: string;
  wandb_project: string;
  primary_metric: string;
  primary_higher_is_better: boolean;
  secondary_metric: string | null;
  secondary_higher_is_better: boolean | null;
};

export function metricsFromRow(row: WorkspaceRow): MetricSet {
  return {
    primary: { key: row.primary_metric, label: labelFor(row.primary_metric), higherIsBetter: row.primary_higher_is_better },
    secondary: row.secondary_metric
      ? { key: row.secondary_metric, label: labelFor(row.secondary_metric), higherIsBetter: !!row.secondary_higher_is_better }
      : null,
  };
}

/** The visitor's credentials from headers, checked for shape. Never logged. */
export function visitorCredentials(request: Request):
  | { ok: true; workspace: string | null; source: WandbSource; geminiKey: string | null }
  | { ok: false; error: string } {
  const h = request.headers;
  const key = h.get(HEADER.wandbKey)?.trim() ?? "";
  const entity = h.get(HEADER.entity)?.trim() ?? "";
  const project = h.get(HEADER.project)?.trim() ?? "";
  const workspace = h.get(HEADER.workspace)?.trim() || null;
  const geminiKey = h.get(HEADER.geminiKey)?.trim() || null;
  if (!key || key.length > 200) return { ok: false, error: "Add your W&B API key on the Connect page." };
  if (!WANDB_NAME.test(entity) || !WANDB_NAME.test(project)) {
    return { ok: false, error: "The W&B entity and project can only use letters, numbers, dots, dashes and underscores." };
  }
  if (workspace !== null && !UUID.test(workspace)) return { ok: false, error: "That workspace ID isn't valid. Reconnect on the Connect page." };
  if (geminiKey && geminiKey.length > 200) return { ok: false, error: "That Gemini key looks too long." };
  return { ok: true, workspace, source: { key, entity, project, owner: false }, geminiKey };
}

/**
 * Works out the journal for this request. Returns a Response to send instead when the
 * request isn't allowed (no owner cookie for an owner write, bad or missing visitor details).
 */
export async function resolveContext(
  request: Request,
  { write }: { write: boolean },
): Promise<{ ctx: JournalContext } | { response: Response }> {
  if (!request.headers.has(HEADER.workspace)) {
    if (write) {
      const denied = await requireOwner();
      if (denied) return { response: denied };
    }
    try {
      return {
        ctx: { workspace: OWNER_WORKSPACE, visitor: false, source: ownerSource(), metrics: OWNER_METRICS, geminiKey: null },
      };
    } catch (err) {
      return { response: errorResponse(err, null) };
    }
  }

  const creds = visitorCredentials(request);
  if (!creds.ok) return { response: Response.json({ error: creds.error }, { status: 400, headers: NO_STORE }) };
  if (!creds.workspace) return { response: Response.json({ error: "Missing workspace ID." }, { status: 400, headers: NO_STORE }) };

  const { data, error } = await db().from("workspaces").select("*").eq("id", creds.workspace).maybeSingle();
  if (error) return { response: errorResponse(new DbError(workspaceDbMessage(error.message)), null) };
  const row = data as WorkspaceRow | null;
  if (!row) {
    return { response: Response.json({ error: "This workspace isn't set up yet. Connect your project again." }, { status: 404, headers: NO_STORE }) };
  }
  if (row.wandb_entity !== creds.source.entity || row.wandb_project !== creds.source.project) {
    return { response: Response.json({ error: "This workspace belongs to a different W&B project. Reconnect on the Connect page." }, { status: 409, headers: NO_STORE }) };
  }
  if (write) {
    void db().from("workspaces").update({ last_seen_at: new Date().toISOString() }).eq("id", row.id).then(() => undefined);
  }
  return {
    ctx: {
      workspace: row.id,
      visitor: true,
      source: creds.source,
      metrics: metricsFromRow(row),
      geminiKey: creds.geminiKey,
    },
  };
}

export function workspaceDbMessage(message: string): string {
  return /workspaces|workspace/i.test(message)
    ? "The database isn't set up for workspaces yet. Run supabase/005_workspaces.sql in the Supabase SQL editor."
    : `Supabase error: ${message}`;
}

/**
 * Workspace limits, checked before the work. Database writes: 100 per IP per day. Gemini on the
 * server's key: 20 calls per IP per day. A visitor's own Gemini key skips the AI limit.
 * The owner is never limited here.
 */
export async function chargeWorkspace(request: Request, ctx: JournalContext, { ai, write }: { ai: boolean; write: boolean }) {
  if (!ctx.visitor) return;
  if (write) {
    const w = await hitRateLimit(request, "workspace-write", WORKSPACE_WRITE_LIMIT, DAY);
    if (!w.allowed) throw new EntryError("You've reached today's limit of 100 saves for workspaces. Try again tomorrow.", 429);
  }
  if (ai && !ctx.geminiKey) {
    const a = await hitRateLimit(request, "workspace-ai", WORKSPACE_AI_LIMIT, DAY);
    if (!a.allowed) {
      throw new EntryError(
        `You've used today's ${WORKSPACE_AI_LIMIT} free AI calls. Add your own free Gemini key on the Connect page for unlimited use.`,
        429,
      );
    }
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

/** The secrets a context carries, for redaction. The owner's keys never come from the request. */
export function secretsOf(ctx: JournalContext | null): string[] {
  if (!ctx?.visitor) return [];
  return [ctx.source.key, ctx.geminiKey].filter((s): s is string => !!s);
}

/**
 * Turns any error into a response with a safe message. Known errors keep their message,
 * with visitor keys scrubbed out; anything else gets a generic message, logged redacted.
 */
export function errorResponse(err: unknown, ctx: JournalContext | null, fallback = "Something went wrong. Try again."): Response {
  const secrets = secretsOf(ctx);
  const headers = ctx?.visitor ? NO_STORE : undefined;
  if (err instanceof EntryError || err instanceof DbError || err instanceof WandbError) {
    return Response.json({ error: redact(err.message, secrets) }, { status: err.status, headers });
  }
  console.error(redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err), secrets));
  return Response.json({ error: fallback }, { status: 500, headers });
}
