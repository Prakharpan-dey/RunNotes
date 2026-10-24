# RunNotes

**A lab notebook for ML experiments that you fill in by talking.** After a training run, hold Fn and ramble for twenty seconds. RunNotes turns that into a journal entry with the run's real numbers from Weights & Biases, and keeps a running list of what has actually moved the score.

**Live:** https://run-notes.vercel.app (no login: try the demo at the top, or connect your own W&B project under **Your project**)

Built for *No Hands: The Wispr Challenge* (WeMakeDevs × Wispr Flow), Builders track.

---

## The problem

After every training run I'm supposed to write down what I changed, what I saw and what I'll try next. It takes me 20 to 40 minutes, so mostly I skip it. Two weeks later I can't say why run 14 beat run 9, and writing up a report means digging through W&B and old chat messages.

W&B keeps the numbers. It doesn't keep the reasoning: what I expected, what I noticed, what I suspected went wrong.

**Who it's for:** anyone who runs a lot of experiments alone and has to explain them later: students, Kaggle competitors, researchers. The first user is me, on my SHL grammar-scoring runs.

## What it does

1. **Talk after a run.** Expand a run, hold Fn with Wispr Flow, and say what happened. Filler words and self-corrections ("twenty MFCCs, no wait, forty") are expected and cleaned up.
2. **Get an entry.** A title, what changed, what I saw, what's next, and a keep / discard / inconclusive verdict. The numbers come from W&B, never from the model.
3. **Fix it by voice.** Say what's wrong ("I said *nice*, I meant *noise*") and the entry and the raw notes are corrected. The changed words are highlighted, and every earlier version is kept.
4. **See what the runs add up to.** The insights panel rebuilds after every entry:
   - **Lever:** a change that beat the best score so far.
   - **No effect:** a change that landed within noise of the best.
   - **Regression:** a change that made things much worse, and what fixed it.
   - **Prediction check:** something I predicted in my notes ("Pearson above 0.6") checked against what W&B actually logged.
5. **Use it on your own runs.** Connect your own W&B project and pick the metric you care about (lower or higher is better, plus an optional second one). You get the full journal in your own workspace, separate from mine.

## Why the numbers can be trusted

The model writes words; code decides facts.

- Every metric shown comes straight from the W&B API. Entries and insights are checked for metric values the model copied in, and sent back if it did.
- Levers, no-effects and regressions are computed in code: walk the runs in order, track the best score on the main metric, compare. A move within 1.5% of the best counts as noise, and a run more than 15% worse is a regression. The same rules apply to every project, whatever its metric.
- For predictions, Gemini only extracts what I said (metric, value, "above / below / around / beat run N"). Code checks the value is really in my notes, then works out the actual result, the difference and its colour from W&B. "Around" means within 3%.
- Gemini runs at temperature 0 for insights and only writes one sentence per fact that code has already decided. It can't add or drop insights.

## How I used Wispr Flow

Flow is on both sides of this project.

- **Building it:** the spec and every prompt to Claude Code were dictated with Flow: features, bug reports, design changes and fixes, spoken the way I'd brief a teammate.
- **Using it:** RunNotes is designed to be fed by voice. The text boxes say "Hold Fn and talk it through", the prompts expect spoken input, and the Fix it box exists because dictation is fast but not perfect. One of my real entries was corrected from "nice" to "noise" by voice.

## Try it

Open https://run-notes.vercel.app.

- **Try it yourself:** the box at the top uses run 4, my current best. Dictate or type what you'd say after that run and you'll get a real entry card, labelled *Demo entry, not saved*. Limited to 5 tries per visitor every 4 hours.
- **My journal:** my real runs, entries and insights. It's read-only for visitors; I unlock it with a passcode to log runs.
- **Your project:** choose **Connect your W&B project**, then enter your W&B API key, entity and project. RunNotes lists the metrics your runs log; pick your main one and you get your own journal with Write entry, Fix it and Regenerate.
  - Your keys stay in your browser tab (`sessionStorage`) and are only sent with your own requests. They're never stored or logged.
  - A Gemini key is optional. Without one you get 5 free AI calls a day, about 2 entries. With your own free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) there's no limit.
  - **Disconnect** clears the keys. Your workspace stays in that browser and comes back when you reconnect the same project.

---

## Run it yourself

**Needs:** Node 20+, a W&B project, a Supabase project and a Gemini API key.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

**Environment variables** (all server-only; none are sent to the browser):

| Name | What it's for |
|---|---|
| `WANDB` | W&B API key, to read the owner journal's runs |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Where entries, insights, workspaces and rate limits are stored |
| `GEMINI_API_KEY` | Writing entries, fixes and insights, for the owner journal, the demo and workspaces without their own key |
| `OWNER_PASSCODE` | Unlocks owner mode (footer → Owner). Without it the owner journal is read-only |
| `GEMINI_MODELS` | Optional. Models to try in order, e.g. `gemini-3.5-flash,gemini-3.5-flash-lite` |

**Database:** run these in the Supabase SQL editor, in order: `supabase/entries.sql`, `002_entry_history.sql`, `003_insights.sql`, `004_rate_limits.sql`, `005_workspaces.sql`. Row-level security is on with no policies, so only the server can read or write. No table stores an API key.

**Pointing "My journal" at your project:** set `WANDB_ENTITY` and `WANDB_PROJECT` in `src/lib/wandb.ts` and `OWNER_METRICS` in `src/lib/metrics.ts`. The demo run is `DEMO_RUN_NUMBER` in `src/lib/demo.ts`, and the free workspace limit is `WORKSPACE_AI_LIMIT` in `src/lib/limits.ts`. Visitors don't need any of this; they connect at `/connect`.

**Deploy:** import the repo on Vercel, add the environment variables, deploy. Pick a function region near your Supabase project.

## How it's built

Next.js 16 (App Router) · Tailwind · shadcn/ui · Supabase (Postgres) · Gemini via `@google/genai` · Zod · Vercel

Every request is for one journal: the owner's (server keys, an owner cookie for writes) or a visitor workspace (a random ID, with the visitor's keys in request headers, never stored).

| Route | Does |
|---|---|
| `GET /api/runs` | Runs, config and summary metrics from the W&B GraphQL API |
| `POST /api/entry` | Notes + run data → Gemini → Zod-checked entry → Supabase *(owner, or the visitor's own workspace)* |
| `POST /api/entry/fix` | Applies a spoken correction to the entry and the notes; keeps the old version in `history` |
| `GET/POST /api/insights` | Latest insights / rebuild them |
| `POST /api/demo/entry` | The public demo: writes an entry for run 4 without saving it, rate-limited |
| `POST/DELETE /api/owner` | Unlock or leave owner mode with a signed, httpOnly cookie |
| `POST /api/workspace/verify` | Checks a visitor's W&B project (and Gemini key, if given) and lists the metrics their runs log |
| `POST /api/workspace` | Creates or updates a visitor workspace with their chosen metrics |
| `GET /api/workspace/journal` | Runs, entries and insights for a visitor workspace |

Key files:
- `src/lib/context.ts`: whose journal a request is for, and the workspace limits.
- `src/lib/entry-writer.ts`: entries and fixes.
- `src/lib/llm.ts`: the Gemini wrapper, with model fallback and per-key quota tracking.
- `src/lib/insights.ts`: facts in code, then sentences.
- `src/lib/metrics.ts`: metric sets and thresholds.
- `src/lib/config-words.ts`: config changes as plain phrases.

## Known limits

- **Gemini's free tier** allows about 20 requests a day per model. The owner journal, the demo and workspaces without their own key share the server's key. RunNotes falls back to a lighter model when one runs out, but heavy use needs a key with billing.
- **A workspace lives in one browser.** Its ID is kept in that browser's `localStorage`, so another browser or device starts a new, empty workspace. Anyone holding a workspace ID and that project's W&B key could open it.
- **Supabase free projects pause** after a week without activity.
- **Predictions are matched to the next run** (or the same run, for "I expected this to…"). A prediction about a run further ahead isn't checked.
