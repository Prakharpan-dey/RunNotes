/** An error whose message is safe and helpful to show the person, with the HTTP status to send. */
export class EntryError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Replaces every occurrence of each secret in `text`, so keys can't leak through error messages or logs. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[key]");
  return out;
}
