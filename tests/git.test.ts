import { describe, expect, it } from 'vitest';
import { redactGitOutputForDisplay, sanitizeGitRemoteForDisplay } from '../src/tools/git.js';

describe('git display hygiene', () => {
  it('removes credentials from remote URLs', () => {
    expect(sanitizeGitRemoteForDisplay('https://user:secret@github.com/owner/repo.git'))
      .toBe('https://github.com/owner/repo.git');
  });

  it('redacts GitHub token material from command output', () => {
    const output = 'token ghp_abc123TOKEN remote https://x-access-token:secret@github.com/owner/repo.git';
    expect(redactGitOutputForDisplay(output)).not.toContain('ghp_abc123TOKEN');
    expect(redactGitOutputForDisplay(output)).not.toContain('secret@');
    expect(redactGitOutputForDisplay(output)).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(redactGitOutputForDisplay(output)).toContain('https://github.com/owner/repo.git');
  });
});
