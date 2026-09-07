// Render-time link splitter for transcript lines. Stored text and the wire
// format stay plain text; only committed rows turn URL spans into anchors.
export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

// Conservative matcher: http/https followed by non-whitespace. Trailing
// punctuation that usually belongs to the sentence, not the address, is
// left in the text stream.
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /https?:\/\/[^\s<>"'`]+/gi;
  let pos = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index;
    const href = raw.replace(/[.,;:!?)\]}]+$/, '');
    const tail = raw.slice(href.length);
    if (start > pos) segments.push({ kind: 'text', text: text.slice(pos, start) });
    // A match with nothing beyond the scheme and stripped punctuation
    // (e.g. "https://.") is not an address; keep it as text.
    if (/^https?:\/\/.+/i.test(href)) segments.push({ kind: 'link', text: href, href });
    else segments.push({ kind: 'text', text: href });
    if (tail) segments.push({ kind: 'text', text: tail });
    pos = start + raw.length;
  }
  if (pos < text.length) segments.push({ kind: 'text', text: text.slice(pos) });
  if (segments.length === 0) segments.push({ kind: 'text', text });
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === 'text' && segment.kind === 'text') last.text += segment.text;
    else merged.push(segment.kind === 'text' ? { kind: 'text', text: segment.text } : segment);
  }
  return merged;
}
