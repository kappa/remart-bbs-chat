// A handle is one word: letters, combining marks, digits, and _ from any
// script, so that @handle in chat can always find it. Keep the pattern and
// the sentence aligned with isValidHandle in server/index.js.
const HANDLE_PATTERN = /^[\p{L}\p{M}\p{N}_]+$/u;

export const HANDLE_RULE = 'Names are one word: letters, digits and _ only';

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}
