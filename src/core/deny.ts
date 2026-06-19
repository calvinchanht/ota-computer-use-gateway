export function deniedPath(relativePath: string, extraGlobs: string[]): string | null {
  return deniedBySimpleGlob(relativePath, extraGlobs);
}

function deniedBySimpleGlob(relativePath: string, globs: string[]): string | null {
  for (const glob of globs) {
    if (matchesSimpleGlob(relativePath, glob)) return `denied by configured glob: ${glob}`;
  }
  return null;
}

function matchesSimpleGlob(relativePath: string, glob: string): boolean {
  const norm = relativePath.replaceAll('\\', '/');
  const normalizedGlob = glob.replaceAll('\\', '/');
  if (normalizedGlob === norm || normalizedGlob === norm.split('/').at(-1)) return true;
  if (normalizedGlob.startsWith('**/') && normalizedGlob.endsWith('/**')) return norm.includes(`/${normalizedGlob.slice(3, -3)}/`) || norm.startsWith(`${normalizedGlob.slice(3, -3)}/`);
  if (normalizedGlob.startsWith('**/') && normalizedGlob.endsWith('*')) return norm.split('/').some((part) => part.includes(normalizedGlob.slice(3, -1)));
  if (normalizedGlob.startsWith('**/')) return norm.endsWith(normalizedGlob.slice(3));
  if (normalizedGlob.endsWith('/**')) return norm.startsWith(normalizedGlob.slice(0, -3));
  if (normalizedGlob.includes('*')) return simpleGlobRegex(normalizedGlob).test(norm);
  return false;
}

function simpleGlobRegex(glob: string): RegExp {
  let source = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\{}()[\]^$+?.]/g, '\$&');
}
