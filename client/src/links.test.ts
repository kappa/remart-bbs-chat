import { describe, it, expect } from 'vitest';
import { splitLinks } from './links';

describe('splitLinks', () => {
  it('leaves plain text alone', () => {
    expect(splitLinks('hello world')).toEqual([{ kind: 'text', text: 'hello world' }]);
    expect(splitLinks('')).toEqual([{ kind: 'text', text: '' }]);
  });
  it('requires an http or https scheme', () => {
    expect(splitLinks('see example.com/x')).toEqual([{ kind: 'text', text: 'see example.com/x' }]);
    expect(splitLinks('ftp://example.com/x')).toEqual([{ kind: 'text', text: 'ftp://example.com/x' }]);
  });
  it('links http and https URLs with surrounding text intact', () => {
    expect(splitLinks('see https://example.com/x ok')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
      { kind: 'text', text: ' ok' },
    ]);
    expect(splitLinks('http://example.com')).toEqual([
      { kind: 'link', text: 'http://example.com', href: 'http://example.com' },
    ]);
  });
  it('excludes trailing punctuation from the link', () => {
    for (const tail of ['.', ',', ';', ':', '!', '?', ')']) {
      expect(splitLinks(`see https://example.com/x${tail}`)).toEqual([
        { kind: 'text', text: 'see ' },
        { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
        { kind: 'text', text: tail },
      ]);
      const trailing = splitLinks(`https://example.com/x${tail} end`);
      expect(trailing[trailing.length - 1]).toEqual({ kind: 'text', text: `${tail} end` });
    }
  });
  it('matches the scheme case-insensitively', () => {
    expect(splitLinks('see HTTPS://example.com/X')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'HTTPS://example.com/X', href: 'HTTPS://example.com/X' },
    ]);
  });
  it('leaves a scheme with no address as text', () => {
    expect(splitLinks('see https://. ok')).toEqual([{ kind: 'text', text: 'see https://. ok' }]);
  });
  it('links several URLs in one line', () => {
    expect(splitLinks('https://a.example/1 then http://b.example/2')).toEqual([
      { kind: 'link', text: 'https://a.example/1', href: 'https://a.example/1' },
      { kind: 'text', text: ' then ' },
      { kind: 'link', text: 'http://b.example/2', href: 'http://b.example/2' },
    ]);
  });
  it('keeps Unicode text around links', () => {
    expect(splitLinks('Привет https://example.com/ж мир')).toEqual([
      { kind: 'text', text: 'Привет ' },
      { kind: 'link', text: 'https://example.com/ж', href: 'https://example.com/ж' },
      { kind: 'text', text: ' мир' },
    ]);
  });
  it('handles a long punctuation run after an address in linear time', () => {
    const text = 'https://example.com/' + '.'.repeat(20000) + 'x';
    const started = performance.now();
    expect(splitLinks(text)).toEqual([{ kind: 'link', text, href: text }]);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
