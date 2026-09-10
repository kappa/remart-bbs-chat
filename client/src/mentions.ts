// Mention tokens for handle autocomplete. Everything here works on the
// server-echoed live text and caret; nothing predicts local keystrokes.
import type { RosterEntry } from './protocol';

export type MentionToken = { start: number; prefix: string };

const isWhitespace = (point: string) => /\s/u.test(point);
const lower = (text: string) => Array.from(text).map((point) => point.toLowerCase());

// The whitespace-delimited run of code points ending at the caret, when it
// starts with `@` and the caret sits at its end. `start` is the code-point
// index of the `@`; `prefix` is what follows it up to the caret.
export function mentionTokenBefore(text: string, caret: number): MentionToken | null {
  const points = Array.from(text);
  const at = Math.min(Math.max(caret, 0), points.length);
  if (at < points.length && !isWhitespace(points[at])) return null;
  let start = at;
  while (start > 0 && !isWhitespace(points[start - 1])) start--;
  if (start === at || points[start] !== '@') return null;
  return { start, prefix: points.slice(start + 1, at).join('') };
}

// Roster entries, in the given order, whose handle starts with the prefix
// comparing lowercased code points. The own participant is never offered.
export function mentionCandidates(prefix: string, roster: RosterEntry[], ownParticipantId: number): RosterEntry[] {
  const wanted = lower(prefix);
  return roster.filter((entry) => {
    if (entry.participantId === ownParticipantId) return false;
    const handle = lower(entry.handle);
    return handle.length >= wanted.length && wanted.every((point, index) => handle[index] === point);
  });
}

// The handle's code points after the prefix: what a pick sends as keystrokes.
export function mentionCompletion(handle: string, prefix: string): string[] {
  return Array.from(handle).slice(Array.from(prefix).length);
}
