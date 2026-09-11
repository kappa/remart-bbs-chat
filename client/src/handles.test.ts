import { describe, it, expect } from 'vitest';
import { isValidHandle } from './handles';

describe('isValidHandle', () => {
  it('accepts one word of letters, marks, digits, and underscores from any script', () => {
    for (const handle of ['alex_k', 'Женя', 'bob2', 'Ünal', 'Ẽ', '日本', '_', '7']) {
      expect(isValidHandle(handle), handle).toBe(true);
    }
  });

  it('rejects whitespace, punctuation, a leading @, and emoji', () => {
    for (const handle of ['', 'Alex K', ' alex', 'Bob!', 'J.', '@alex', 'a-b', 'a\tb', 'x🙂', '🙂']) {
      expect(isValidHandle(handle), JSON.stringify(handle)).toBe(false);
    }
  });
});
