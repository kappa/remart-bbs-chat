// Mention tokens for handle autocomplete. Everything here works on the
// server-echoed live text and caret; nothing predicts local keystrokes.
import { stripTrailingPunctuation } from './links';
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

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; handle: string; color: string };

const MENTION_PATTERN = /(^|\s)(@\S+)/gu;

function findMentions(text: string): { start: number; end: number; name: string }[] {
  const found: { start: number; end: number; name: string }[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const token = stripTrailingPunctuation(match[2]);
    if (token.length < 2) continue;
    const start = match.index + match[1].length;
    found.push({ start, end: start + token.length, name: token.slice(1) });
  }
  return found;
}

// Splits committed text into plain runs and exact mentions of current roster
// members. Indices are used only to slice the same UTF-16 string.
export function splitMentions(text: string, roster: RosterEntry[]): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let pos = 0;
  for (const { start, end, name } of findMentions(text)) {
    const wanted = name.toLowerCase();
    const entry = roster.find((candidate) => candidate.handle.toLowerCase() === wanted);
    if (!entry) continue;
    if (start > pos) segments.push({ kind: 'text', text: text.slice(pos, start) });
    segments.push({ kind: 'mention', text: text.slice(start, end), handle: entry.handle, color: entry.color });
    pos = end;
  }
  if (pos < text.length || segments.length === 0) segments.push({ kind: 'text', text: text.slice(pos) });
  return segments;
}

export function mentionsHandle(text: string, handle: string): boolean {
  const wanted = handle.toLowerCase();
  return findMentions(text).some((mention) => mention.name.toLowerCase() === wanted);
}
