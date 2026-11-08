import { describe, expect, it } from 'vitest';
import { tokenize } from './code-block';
import { truncateId } from './mono-id';

describe('tokenize', () => {
  it('splits keywords, strings and comments and keeps every character', () => {
    const code = "const x = 'a'; // note\nawait f(\"b\")";
    const tokens = tokenize(code);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
    expect(tokens.filter((t) => t.kind === 'keyword').map((t) => t.text)).toEqual(['const', 'await']);
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(["'a'", '"b"']);
    expect(tokens.filter((t) => t.kind === 'comment').map((t) => t.text)).toEqual(['// note']);
  });

  it('treats markup as plain text, never as HTML', () => {
    const tokens = tokenize('<img src=x onerror=alert(1)>');
    expect(tokens.map((t) => t.text).join('')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('truncateId', () => {
  it('keeps 6 leading and 4 trailing characters', () => {
    expect(truncateId('0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f')).toBe('0x8bf8...199f');
  });

  it('leaves short ids alone', () => {
    expect(truncateId('0x1234')).toBe('0x1234');
  });
});
