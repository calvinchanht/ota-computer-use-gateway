import { describe, expect, it } from 'vitest';
import { shouldUseQuotaSaver } from '../src/server/http.js';

describe('HTTP JSON quota saver defaults', () => {
  it('defaults long-prone workspace tools to quota_saver', () => {
    expect(shouldUseQuotaSaver('search_files', {})).toBe(true);
    expect(shouldUseQuotaSaver('run_command', {})).toBe(true);
  });

  it('keeps fast workspace tools synchronous by default', () => {
    expect(shouldUseQuotaSaver('read_file', {})).toBe(false);
    expect(shouldUseQuotaSaver('write_file', {})).toBe(false);
    expect(shouldUseQuotaSaver('edit_file', {})).toBe(false);
  });

  it('preserves explicit sync override for debugging', () => {
    expect(shouldUseQuotaSaver('search_files', { async_mode: 'sync' })).toBe(false);
    expect(shouldUseQuotaSaver('run_command', { async_mode: 'off' })).toBe(false);
  });

  it('keeps browser and Cua long operations async by default', () => {
    expect(shouldUseQuotaSaver('browser_cdp_call', {})).toBe(true);
    expect(shouldUseQuotaSaver('cua_driver_call', {})).toBe(true);
    expect(shouldUseQuotaSaver('cua_driver_status', {})).toBe(false);
  });
});
