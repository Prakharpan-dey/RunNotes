export type DiffToken = { text: string; added: boolean };

/**
 * Marks which words in `after` are new compared with `before` (longest common subsequence
 * on whitespace-separated words). Removed words are dropped; the card only shows the new text.
 */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  // Too long to diff cheaply: show the new text unmarked.
  if (a.length * b.length > 4_000_000) return [{ text: after, added: false }];

  const lcs: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      tokens.push({ text: b[j], added: false });
      i++;
      j++;
    } else if (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      // Whitespace between two marked words stays marked so the highlight reads as one run.
      tokens.push({ text: b[j], added: !/^\s+$/.test(b[j]) });
      j++;
    }
  }
  for (let k = 1; k < tokens.length - 1; k++) {
    if (/^\s+$/.test(tokens[k].text) && tokens[k - 1].added && tokens[k + 1].added) tokens[k].added = true;
  }
  return tokens;
}
