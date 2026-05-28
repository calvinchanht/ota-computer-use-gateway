import { describe, expect, it } from 'vitest';
import { deniedPath } from '../src/core/deny.js';

describe('deniedPath', () => {
  it('denies env files', () => {
    expect(deniedPath('.env', [])).toContain('denied');
    expect(deniedPath('src/.env.local', [])).toContain('denied');
  });

  it('denies key material', () => {
    expect(deniedPath('id_ed25519', [])).toContain('denied');
    expect(deniedPath('certs/private.pem', [])).toContain('denied');
  });

  it('allows normal source paths', () => {
    expect(deniedPath('src/index.ts', [])).toBeNull();
  });
});
