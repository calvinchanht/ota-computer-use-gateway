import { afterEach, describe, expect, it } from 'vitest';
import { childProcessEnvironment } from '../src/core/processEnvironment.js';

const ORIGINAL_PATHEXT = process.env.PATHEXT;
const ORIGINAL_MARKER = process.env.OTA_TEST_ADMIN_MARKER;

afterEach(() => {
  if (ORIGINAL_PATHEXT === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = ORIGINAL_PATHEXT;
  if (ORIGINAL_MARKER === undefined) delete process.env.OTA_TEST_ADMIN_MARKER; else process.env.OTA_TEST_ADMIN_MARKER = ORIGINAL_MARKER;
});

describe('childProcessEnvironment', () => {
  it('full mode inherits the complete operational environment including PATHEXT', () => {
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.env.OTA_TEST_ADMIN_MARKER = 'admin-env-ok';
    const env = childProcessEnvironment('full');
    expect(env.PATHEXT).toBe('.COM;.EXE;.BAT;.CMD');
    expect(env.OTA_TEST_ADMIN_MARKER).toBe('admin-env-ok');
  });

  it('minimal mode keeps only the compatibility allowlist', () => {
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.env.OTA_TEST_ADMIN_MARKER = 'admin-env-ok';
    const env = childProcessEnvironment('minimal');
    expect(env.PATHEXT).toBeUndefined();
    expect(env.OTA_TEST_ADMIN_MARKER).toBeUndefined();
    expect(env.PATH).toBeDefined();
    expect(Object.keys(env).every((key) => ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'].includes(key))).toBe(true);
  });

  it('permits explicit server-side overrides in either mode', () => {
    const env = childProcessEnvironment('minimal', { GITHUB_TOKEN: 'injected-test-value' });
    expect(env.GITHUB_TOKEN).toBe('injected-test-value');
  });
});
