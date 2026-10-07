import { normalizeBdPhone } from './phone.js';
import { variantLabel } from './variant-label.js';

describe('normalizeBdPhone', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['017-1234 5678', '+8801712345678'],
    ['01312345678', '+8801312345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each(['0171234567', '011234567890', '01212345678', '+441712345678', 'abc', ''])('rejects %s', (input) => {
    expect(normalizeBdPhone(input)).toBeNull();
  });
});

describe('variantLabel', () => {
  it('joins option values', () => {
    expect(variantLabel({ size: 'M', color: 'Navy' })).toBe('M / Navy');
    expect(variantLabel({})).toBe('');
    expect(variantLabel(null)).toBe('');
  });
});
