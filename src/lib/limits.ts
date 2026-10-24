/**
 * Free AI calls per visitor IP per day for workspaces on the server's Gemini key.
 * Writing an entry or applying a fix costs 2 (the call itself plus the insights rebuild).
 * A visitor's own Gemini key isn't limited.
 */
export const WORKSPACE_AI_LIMIT = 5;
