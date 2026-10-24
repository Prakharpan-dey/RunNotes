# RunNotes

**The experiment journal you fill in by talking.**

RunNotes turns a few seconds of spoken notes after a training run into a structured journal entry, backed by the run's real numbers from [Weights & Biases](https://wandb.ai). Across runs, it keeps track of what actually moved your score, what made no difference, and where your own predictions were wrong.

**Live:** [run-notes.vercel.app](https://run-notes.vercel.app). No sign-up needed: try the demo, or connect your own W&B project.

---

## Why RunNotes

W&B records what happened in a run: the config, the metrics, the curves. It doesn't record *why*: what you expected, what you noticed in the outputs, what you suspect went wrong, and what you plan to try next. That reasoning usually lives in your head, a chat thread or nowhere. Two weeks later nobody can say why run 14 beat run 9.

Writing it down takes long enough that it gets skipped. RunNotes makes it a twenty-second habit: finish a run, say what happened, done.

It's built for people who run many experiments and have to explain them later: researchers, students, Kaggle competitors and small ML teams.

## Features

- **Dictate an entry.** Open a run and talk through what you changed and what you saw. Filler words, half sentences and self-corrections ("twenty MFCCs, no wait, forty") are expected and cleaned up.
- **Structured entries.** Every entry has a plain-English title, what changed, observations, next steps, tags and a keep / discard / inconclusive verdict. Metrics come from W&B, never from the model.
- **Fix by voice.** Say what's wrong ("the verdict should be keep") and both the entry and your original notes are corrected. The changed words are highlighted, and every previous version is kept.
- **Insights across runs.** A panel that rebuilds after every entry:
  - **Lever:** a change that set a new best score.
  - **No effect:** a change that landed within noise of the best.
  - **Regression:** a change that made things much worse, and what fixed it.
  - **Prediction check:** a prediction from your notes ("Pearson above 0.6", "should beat run 4") compared with what W&B logged.
- **Any project, any metric.** Connect a W&B project and choose the metric that matters, whether lower or higher is better, plus an optional second one.
- **Built for voice.** Every input is designed for speech. It works well with system-wide dictation tools such as Wispr Flow, macOS Dictation or Windows Voice Typing, and typing works too.

## How it works

1. **Runs** are read live from the W&B GraphQL API: config, summary metrics and state.
2. **Your notes** and the run data go to Gemini, which returns a strict JSON entry. Zod validates it, and invalid or incomplete replies are retried with feedback.
3. **Numbers are attached in code.** The changes in config and metrics against the previous run are computed from W&B and stored with the entry.
4. **Insights** are computed in code first, then written up. Code walks your runs in order, tracks the best score on the main metric, and decides which facts exist. Gemini only writes one sentence per fact.

### Why the numbers can be trusted

The model writes words; code decides facts.

- Every metric shown comes straight from W&B. Entries and insights are checked for metric values the model copied in, including spelled-out ones like "zero point six seven", and sent back if found.
- Levers, no-effects and regressions follow fixed rules. A move within **1.5%** of the best score counts as noise, and a run more than **15%** worse is a regression. The same rules apply to every project.
- For predictions, the model only extracts what you said: the metric, the value, and above / below / around / beat run N. Code checks that the value really appears in your notes, then works out the actual result, the difference and its colour from W&B. "Around" means within 3%.
- Insights run at temperature 0, and the model can't add or remove insights. Wrong-length headlines and missing sentences fall back to templates.

## Using it

The app has three areas:

| | |
|---|---|
| **Try it yourself** | A one-off demo on a sample run. Dictate or type, and you get a real entry card that isn't saved. Limited to 5 tries per visitor every 4 hours. |
| **Journal** | The owner's journal. Public and read-only for visitors; the owner unlocks writing with a passcode. |
| **Your project** | Your own workspace on your own W&B project, with everything above: write entries, fix them and rebuild insights. |

### Connecting your project

1. Go to **Your project → Connect your W&B project**.
2. Enter your W&B API key (from [wandb.ai/authorize](https://wandb.ai/authorize)), your entity and your project name.
3. Optionally add a Gemini API key (free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Without one, a workspace gets **5 AI calls a day**, about 2 entries, since each entry also rebuilds insights. With your own key there's no limit.
4. **Check connection.** RunNotes lists the numeric metrics your runs log. Pick the main one and whether lower or higher is better, plus an optional second metric.
5. **Connect.** You land in your journal.

**Disconnect** clears your keys. Your workspace stays tied to that browser and comes back when you reconnect the same project.

## Security and privacy

- **Your API keys are never stored.** They're kept in your browser tab's `sessionStorage`, sent only as request headers on your own requests, and used in memory for that request. No database table has a column for them.
- **Keys are kept out of errors and logs.** Every error message on the workspace paths is scrubbed of the keys in that request, and workspace responses are sent with `Cache-Control: no-store`.
- **Workspaces are isolated.** Entries and insights are stored per workspace, so a workspace can't read or write the owner's journal or another workspace.
- **Writes are checked on the server.** The owner journal needs a signed, httpOnly cookie, issued after a passcode check that is limited to 10 tries per 15 minutes. Hiding a button is never the only protection.
- **Rate limits** are enforced in Postgres with an atomic counter, storing only a hash of the visitor's IP: the demo, connection checks, free AI calls and workspace saves.
- **Row-level security is on** for every table, with no policies, so only the server (using the service role key) can read or write data.

## Self-hosting

**Requirements:** Node.js 20+, a Supabase project, a W&B account and a Gemini API key.

```bash
git clone https://github.com/Prakharpan-dey/RunNotes.git
cd RunNotes
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

### Environment variables

All of them are server-only; none are exposed to the browser.

| Name | Required | Purpose |
|---|---|---|
| `WANDB` | Yes | W&B API key for the owner journal |
| `WANDB_ENTITY` | Yes | The owner journal's W&B entity (user or team), as in `wandb.ai/<entity>/<project>` |
| `WANDB_PROJECT` | Yes | The owner journal's W&B project |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server access to Supabase |
| `GEMINI_API_KEY` | Yes | Used by the owner journal, the demo and workspaces without their own key |
| `OWNER_PASSCODE` | Recommended | Unlocks owner mode. Without it the owner journal is read-only for everyone |
| `GEMINI_MODELS` | No | Models to try in order, e.g. `gemini-3.5-flash,gemini-3.5-flash-lite` |

### Database

In the Supabase SQL editor, run the files in `supabase/` in order:

1. `entries.sql`
2. `002_entry_history.sql`
3. `003_insights.sql`
4. `004_rate_limits.sql`
5. `005_workspaces.sql`

### Configuration

| Setting | Where |
|---|---|
| Owner journal's W&B entity and project | `WANDB_ENTITY`, `WANDB_PROJECT` environment variables |
| Owner journal's metrics and directions | `OWNER_METRICS` in `src/lib/metrics.ts` |
| Insight thresholds (noise, regression, "around") | `NOISE_REL`, `REGRESSION_REL`, `AROUND_REL` in `src/lib/metrics.ts` |
| Free AI calls per workspace per day | `WORKSPACE_AI_LIMIT` in `src/lib/limits.ts` |
| Demo run | `DEMO_RUN_NUMBER` in `src/lib/demo.ts` |

### Deployment

RunNotes is a standard Next.js app and deploys to [Vercel](https://vercel.com) as is. Import the repository, add the environment variables, and deploy. Choose a function region close to your Supabase project, because each request makes several database calls.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase (Postgres) · Gemini via `@google/genai` · Zod · Vercel

Every request is resolved to one journal:
- **the owner's**: server-side keys, plus a signed cookie for writes;
- **or a visitor workspace**: a random UUID, with that visitor's keys in request headers.

The same code paths serve both.

### API

| Route | Purpose |
|---|---|
| `GET /api/runs` | Runs, config and summary metrics from W&B |
| `POST /api/entry` | Write an entry from spoken notes |
| `POST /api/entry/fix` | Apply a spoken correction; the previous version is kept in `history` |
| `GET /api/insights` · `POST /api/insights` | Latest insights · rebuild them |
| `POST /api/demo/entry` | Demo entry, not saved; rate-limited |
| `POST /api/owner` · `DELETE /api/owner` | Unlock · leave owner mode |
| `POST /api/workspace/verify` | Check a W&B project (and an optional Gemini key) and list its metrics |
| `POST /api/workspace` | Create or update a workspace and its metric choices |
| `GET /api/workspace/journal` | Runs, entries and insights for a workspace |

Writing or fixing an entry rebuilds insights in the background (`after()`). The page polls until the new version is ready.

### Code map

| Path | What's there |
|---|---|
| `src/lib/context.ts` | Resolving the journal for a request, workspace limits, error redaction |
| `src/lib/entry-writer.ts` | Entries and fixes: prompts, validation, metric-leak checks |
| `src/lib/insights.ts` | Insight facts in code, prediction extraction, sentence writing |
| `src/lib/llm.ts` | Gemini wrapper with model fallback and per-key quota tracking |
| `src/lib/metrics.ts` | Metric sets and thresholds |
| `src/lib/wandb.ts` | W&B GraphQL client |
| `src/lib/config-words.ts` | Config changes as readable phrases ("switching from Ridge to LightGBM") |
| `src/app/connect`, `src/app/workspace` | Connecting a project and the workspace journal |
| `supabase/` | Database schema, in order |

## Limitations

- **Gemini's free tier** allows around 20 requests per model per day. The owner journal, the demo and workspaces without their own key share the server's key. RunNotes falls back to a lighter model when one is exhausted, but heavier use needs a key with billing enabled.
- **A workspace belongs to one browser.** Its ID is kept in `localStorage`, so another browser or device starts a new, empty workspace. Anyone holding a workspace ID and that project's W&B key could open it.
- **Predictions are checked against the run they refer to:** the next run, or the same run for "I expected this to…". Predictions about runs further ahead aren't checked.
- **Only W&B is supported** as a run source, and only Gemini as a model provider. The model layer (`src/lib/llm.ts`) is built so other providers can be added.
- **Supabase free projects pause** after a week without activity.
