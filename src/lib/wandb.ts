import "server-only";

export const WANDB_ENTITY = "prvkhvr-national-institute-of-technology-hamirpur";
export const WANDB_PROJECT = "shl-grammar";

const GRAPHQL_URL = "https://api.wandb.ai/graphql";
const PAGE_SIZE = 100;
const MAX_RUNS = 500;

export type Scalar = string | number | boolean | null;

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

export async function fetchRuns(): Promise<Run[]> {
  const key = process.env.WANDB;
  if (!key) {
    throw new WandbError(
      "No W&B API key found. Add WANDB=<your key> to .env.local and restart the dev server.",
      500,
    );
  }

  const auth = `Basic ${Buffer.from(`api:${key}`).toString("base64")}`;
  const runs: Run[] = [];
  let cursor: string | null = null;

  do {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        query: RUNS_QUERY,
        variables: { entity: WANDB_ENTITY, project: WANDB_PROJECT, first: PAGE_SIZE, cursor },
      }),
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      throw new WandbError("W&B rejected the API key. Check the WANDB value in .env.local.", 401);
    }
    if (!res.ok) {
      throw new WandbError(`W&B returned HTTP ${res.status}. Try again in a moment.`, 502);
    }

    const body = (await res.json()) as RunsResponse;
    if (body.errors?.length) {
      throw new WandbError(`W&B query failed: ${body.errors[0].message}`, 502);
    }
    const project = body.data?.project;
    if (!project) {
      throw new WandbError(
        `Project ${WANDB_ENTITY}/${WANDB_PROJECT} not found, or this API key can't see it.`,
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
        url: `https://wandb.ai/${WANDB_ENTITY}/${WANDB_PROJECT}/runs/${node.name}`,
      });
    }

    cursor = project.runs.pageInfo.hasNextPage ? project.runs.pageInfo.endCursor : null;
  } while (cursor && runs.length < MAX_RUNS);

  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
