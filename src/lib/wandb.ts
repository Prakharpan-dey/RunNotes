import "server-only";
import { cacheLife } from "next/cache";

export const WANDB_ENTITY = "prvkhvr-national-institute-of-technology-hamirpur";
export const WANDB_PROJECT = "shl-grammar";

const GRAPHQL_URL = "https://api.wandb.ai/graphql";
const PAGE_SIZE = 100;
const MAX_RUNS = 500;

export type Scalar = string | number | boolean | null;

/** Where runs come from: the owner's project (env key) or a visitor's (key from their browser tab). */
export type WandbSource = {
  key: string;
  entity: string;
  project: string;
  /** true for the owner's journal; changes where error messages tell people to look. */
  owner: boolean;
};

export type Run = {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  config: Record<string, unknown>;
  summary: Record<string, Scalar>;
  url: string;
};

export class WandbError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const RUNS_QUERY = `
  query Runs($entity: String!, $project: String!, $first: Int!, $cursor: String) {
    project(name: $project, entityName: $entity) {
      runs(first: $first, after: $cursor, order: "-created_at") {
        edges {
          node { name displayName state createdAt config summaryMetrics }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

type RunNode = {
  name: string;
  displayName: string | null;
  state: string;
  createdAt: string;
  config: string | null;
  summaryMetrics: string | null;
};

type RunsResponse = {
  data?: {
    project: {
      runs: {
        edges: { node: RunNode }[];
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
      };
    } | null;
  };
  errors?: { message: string }[];
};

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// W&B stores config as { key: { value, desc } } and adds a private `_wandb` key.
function unwrapConfig(raw: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parseJson(raw))) {
    if (key.startsWith("_")) continue;
    out[key] =
      entry && typeof entry === "object" && "value" in entry
        ? (entry as { value: unknown }).value
        : entry;
  }
  return out;
}

// Keep plain values only; histograms, tables and media come back as nested objects.
function cleanSummary(raw: string | null): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(parseJson(raw))) {
    if (key.startsWith("_")) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value as Scalar;
    }
  }
  return out;
}

// W&B returns createdAt without a timezone; it is UTC.
function toIso(createdAt: string): string {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt}Z`;
}

/** The owner's project, using the server's WANDB key. */
export function ownerSource(): WandbSource {
  const key = process.env.WANDB;
  if (!key) {
    throw new WandbError(
      "No W&B API key found. Add WANDB=<your key> to .env.local and restart the dev server.",
      500,
    );
  }
  return { key, entity: WANDB_ENTITY, project: WANDB_PROJECT, owner: true };
}

/** W&B entity and project names: letters, digits, dot, dash, underscore. */
export const WANDB_NAME = /^[A-Za-z0-9._-]{1,128}$/;

function runUrl(source: WandbSource, runId: string): string {
  return `https://wandb.ai/${encodeURIComponent(source.entity)}/${encodeURIComponent(source.project)}/runs/${encodeURIComponent(runId)}`;
}

export function projectUrl(source: Pick<WandbSource, "entity" | "project">): string {
  return `https://wandb.ai/${encodeURIComponent(source.entity)}/${encodeURIComponent(source.project)}`;
}

/** Every run in the project (up to MAX_RUNS), newest first. The key never appears in errors. */
export async function fetchRuns(source: WandbSource = ownerSource()): Promise<Run[]> {
  const auth = `Basic ${Buffer.from(`api:${source.key}`).toString("base64")}`;
  const where = source.owner ? "the WANDB value in .env.local" : "it on the Connect page";
  const runs: Run[] = [];
  let cursor: string | null = null;

  do {
    let res: Response;
    try {
      res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          query: RUNS_QUERY,
          variables: { entity: source.entity, project: source.project, first: PAGE_SIZE, cursor },
        }),
        cache: "no-store",
      });
    } catch {
      throw new WandbError("Couldn't reach W&B. Try again in a moment.", 502);
    }

    if (res.status === 401 || res.status === 403) {
      throw new WandbError(`W&B rejected the API key. Check ${where}.`, 401);
    }
    if (!res.ok) {
      throw new WandbError(`W&B returned HTTP ${res.status}. Try again in a moment.`, 502);
    }

    const body = (await res.json()) as RunsResponse;
    if (body.errors?.length) {
      throw new WandbError(`W&B query failed: ${body.errors[0].message.slice(0, 200)}`, 502);
    }
    const project = body.data?.project;
    if (!project) {
      throw new WandbError(
        `Project ${source.entity}/${source.project} not found, or this API key can't see it.`,
        404,
      );
    }

    for (const { node } of project.runs.edges) {
      runs.push({
        id: node.name,
        name: node.displayName || node.name,
        state: node.state,
        createdAt: toIso(node.createdAt),
        config: unwrapConfig(node.config),
        summary: cleanSummary(node.summaryMetrics),
        url: runUrl(source, node.name),
      });
    }

    cursor = project.runs.pageInfo.hasNextPage ? project.runs.pageInfo.endCursor : null;
  } while (cursor && runs.length < MAX_RUNS);

  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** For the Connect page: how many runs, and which numeric summary metrics they log (most common first). */
export async function inspectProject(source: WandbSource): Promise<{ runCount: number; metricKeys: string[] }> {
  const runs = await fetchRuns(source);
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.summary)) {
      if (typeof value === "number" && Number.isFinite(value)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const metricKeys = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
    .slice(0, 60);
  return { runCount: runs.length, metricKeys };
}

/**
 * The owner journal's runs for page views, cached for a minute (served stale for up to
 * 10 minutes while refreshing) so every visitor doesn't cost a W&B round trip. Writes and
 * visitor workspaces call fetchRuns directly and always see live data, so an entry for a
 * run you just logged never hits a stale list.
 */
export async function fetchOwnerRunsCached(): Promise<Run[]> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 600 });
  return fetchRuns(ownerSource());
}
