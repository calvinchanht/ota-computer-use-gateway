import { describe, expect, it } from 'vitest';
import { looksSecret, redactSecrets } from '../src/core/secrets.js';

describe('secret compatibility helpers', () => {
  it('disables secret-like content heuristics by default', () => {
    expect(looksSecret('GITHUB_TOKEN=placeholder')).toBe(false);
    expect(looksSecret('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
  });

  it('restores secret-like content heuristics when explicitly enabled', () => {
    expect(looksSecret('GITHUB_TOKEN=placeholder', true)).toBe(true);
    expect(looksSecret('Bearer abcdefghijklmnopqrstuvwxyz123456', true)).toBe(true);
  });

  it('disables secret-value redaction by default and restores it explicitly', () => {
    const value = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
    expect(redactSecrets(value)).toBe(value);
    expect(redactSecrets(value, true)).toBe('Bearer [REDACTED]');
  });
});
