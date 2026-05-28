import { describe, expect, it } from 'vitest';
import { platformKind } from '../src/core/platform.js';

describe('platformKind', () => {
  it('maps supported platforms', () => {
    expect(platformKind('linux')).toBe('linux');
    expect(platformKind('darwin')).toBe('macos');
    expect(platformKind('win32')).toBe('windows');
  });

  it('handles unknown platforms', () => {
    expect(platformKind('sunos')).toBe('unknown');
  });
});
