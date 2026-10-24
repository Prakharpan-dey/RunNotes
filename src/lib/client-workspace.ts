/**
 * Browser-side storage for "Use your own project".
 * - Keys (W&B, optional Gemini) live in sessionStorage: this tab only, gone when it closes.
 * - Workspace IDs live in localStorage, one per W&B entity/project, so reconnecting the same
 *   project later brings back the same journal. They aren't secrets on their own, but anyone
 *   holding one (plus that project's W&B key) can open that workspace.
 */

export type Connection = {
  wandbKey: string;
  entity: string;
  project: string;
  geminiKey: string | null;
};

const SESSION_KEY = "runnotes.connection";
const WORKSPACES_KEY = "runnotes.workspaces";

export function loadConnection(): Connection | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Connection>;
    if (!c.wandbKey || !c.entity || !c.project) return null;
    return { wandbKey: c.wandbKey, entity: c.entity, project: c.project, geminiKey: c.geminiKey || null };
  } catch {
    return null;
  }
}

export function saveConnection(c: Connection) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(c));
}

/*
 * For useSyncExternalStore: the current connection, as the same object until storage changes,
 * so React doesn't re-render forever. On the server there's no storage: `undefined` = unknown yet.
 */
let cachedRaw: string | null | undefined;
let cachedConnection: Connection | null = null;

export function connectionSnapshot(): Connection | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedConnection = loadConnection();
  }
  return cachedConnection;
}

export function serverConnectionSnapshot(): Connection | null | undefined {
  return undefined;
}

export function subscribeConnection(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Clears the keys from this tab. The workspace ID stays, so the journal is still there next time. */
export function disconnect() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}

function readWorkspaces(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** The workspace ID for this entity/project, creating and remembering one if needed. */
export function workspaceIdFor(entity: string, project: string): string {
  const key = `${entity}/${project}`;
  const all = readWorkspaces();
  if (all[key]) return all[key];
  const id = crypto.randomUUID();
  all[key] = id;
  try {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the workspace only lasts for this page.
  }
  return id;
}

/** Headers that carry the visitor's credentials to the server for one request. */
export function workspaceHeaders(c: Connection, workspaceId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "x-rn-wandb-key": c.wandbKey,
    "x-rn-wandb-entity": c.entity,
    "x-rn-wandb-project": c.project,
  };
  if (workspaceId) h["x-rn-workspace"] = workspaceId;
  if (c.geminiKey) h["x-rn-gemini-key"] = c.geminiKey;
  return h;
}

/** A first guess at a metric's direction from its name: losses and errors go down. */
export function guessLowerIsBetter(key: string): boolean {
  return /loss|err|rmse|mse|mae|wer|cer|perplex|ppl|distance|lpips|fid/i.test(key);
}
