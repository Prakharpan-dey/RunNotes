import "server-only";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import { EntryError, redact } from "@/lib/errors";

/**
 * The one place RunNotes talks to an AI model. Today that's Gemini only; another provider
 * would plug in as a second branch of callModel, returning the same { text, model }.
 */

/**
 * Tried in order. On the free tier each model has its own daily quota (20 requests for
 * gemini-3.5-flash), so falling back keeps RunNotes working when the first runs out.
 * Override with GEMINI_MODELS=a,b,c (or GEMINI_MODEL=a for a single model).
 */
export const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

let serverClient: GoogleGenAI | null = null;

/** A visitor's key gets a fresh client per request; the server's client is reused. */
function clientFor(visitorKey: string | null): { client: GoogleGenAI; keyId: string; key: string } {
  if (visitorKey) {
    return {
      client: new GoogleGenAI({ apiKey: visitorKey }),
      keyId: createHash("sha256").update(visitorKey).digest("hex").slice(0, 16),
      key: visitorKey,
    };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new EntryError("No Gemini API key found. Add GEMINI_API_KEY to .env.local.", 500);
  serverClient ??= new GoogleGenAI({ apiKey: key });
  return { client: serverClient, keyId: "server", key };
}

/** Models that ran out of quota, per key, and when to try them again. Lives as long as the server process. */
const exhaustedUntil = new Map<string, number>();

function retryAfterMs(message: string): number {
  const s = message.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)s/i);
  // No hint: a per-minute limit clears in a minute; a daily one we re-check hourly.
  return s ? Number(s[1]) * 1000 : /PerDay/i.test(message) ? 3_600_000 : 60_000;
}

export type ModelRequest = {
  /** The visitor's own Gemini key, or null for the server's key. */
  visitorKey: string | null;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  temperature: number;
  /** The button the person pressed, for "press X again" messages. */
  action: string;
};

/**
 * Asks for strict JSON. Tries each model in MODELS in order: one that's out of quota is
 * skipped until it resets, an overloaded one gets one quick retry before moving on.
 */
export async function callModel(req: ModelRequest): Promise<{ text: string | undefined; model: string }> {
  const { client, keyId, key } = clientFor(req.visitorKey);
  const own = req.visitorKey !== null;
  const now = Date.now();
  const slot = (model: string) => `${keyId}:${model}`;
  const available = MODELS.filter((m) => (exhaustedUntil.get(slot(m)) ?? 0) <= now);
  let overloaded = false;

  for (const model of available) {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const res = await client.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            temperature: req.temperature,
          },
        });
        return { text: res.text, model };
      } catch (err) {
        const message = redact(err instanceof Error ? err.message : String(err), [key]);
        if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|\b403\b/i.test(message)) {
          throw new EntryError(
            own
              ? "Your Gemini key was rejected. Check it on the Connect page."
              : "The server's Gemini key was rejected. Check GEMINI_API_KEY.",
            own ? 401 : 500,
          );
        }
        if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)) {
          exhaustedUntil.set(slot(model), Date.now() + retryAfterMs(message));
          console.warn(`Gemini ${model} is out of quota for ${own ? "a visitor key" : "the server key"}; trying the next model.`);
          break;
        }
        if (/\b50[03]\b|\b404\b|UNAVAILABLE|INTERNAL|NOT_FOUND|overloaded|high demand/i.test(message)) {
          overloaded = true;
          if (tries === 0 && !/\b404\b|NOT_FOUND/.test(message)) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          break;
        }
        throw new EntryError(`Gemini request failed: ${message.slice(0, 200)}`);
      }
    }
  }

  if (overloaded) {
    throw new EntryError(`Gemini is overloaded right now. Wait a few seconds and press ${req.action} again.`, 503);
  }
  const soonest = Math.min(...MODELS.map((m) => exhaustedUntil.get(slot(m)) ?? now));
  const minutes = Math.max(1, Math.round((soonest - now) / 60_000));
  const wait = minutes < 90 ? `${minutes} min` : `about ${Math.round(minutes / 60)} h`;
  throw new EntryError(
    own
      ? `Your Gemini key's quota is used up on every model. It frees up in ${wait}.`
      : `Gemini's free quota is used up on every model (${MODELS.join(", ")}). It frees up in ${wait}. ` +
          `A key with billing enabled removes the limit.`,
    429,
  );
}

/** One tiny request to check a visitor's key works. Throws an EntryError with a friendly message if not. */
export async function checkGeminiKey(visitorKey: string): Promise<void> {
  await callModel({
    visitorKey,
    system: "Reply with the JSON object {\"ok\": true}.",
    prompt: "ok?",
    jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    temperature: 0,
    action: "Check connection",
  });
}
