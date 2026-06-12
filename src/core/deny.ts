const DENIED_NAMES = new Set(['.env', 'id_rsa', 'id_ed25519']);
const DENIED_PARTS = new Set(['.ssh', '.gnupg', '.aws', '.kube', 'secrets']);

export function deniedPath(relativePath: string, extraGlobs: string[], protectSecretPaths = true): string | null {
  if (!protectSecretPaths) return deniedBySimpleGlob(relativePath, extraGlobs);
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const name = parts.at(-1) ?? '';
  if (DENIED_NAMES.has(name)) return `denied secret-like file: ${name}`;
  if (name.startsWith('.env.')) return `denied secret-like file: ${name}`;
  if (name.endsWith('.pem') || name.endsWith('.key')) return `denied secret-like file: ${name}`;
  if (/token|credential|secret|password|passwd/i.test(name)) return `denied secret-like file: ${name}`;
  if (parts.some((part) => DENIED_PARTS.has(part))) return 'denied secret-like directory';
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
  if (glob === norm || glob === norm.split('/').at(-1)) return true;
  if (glob.startsWith('**/') && glob.endsWith('/**')) return norm.includes(`/${glob.slice(3, -3)}/`) || norm.startsWith(`${glob.slice(3, -3)}/`);
  if (glob.startsWith('**/') && glob.endsWith('*')) return norm.split('/').some((part) => part.includes(glob.slice(3, -1)));
  if (glob.startsWith('**/')) return norm.endsWith(glob.slice(3));
  if (glob.endsWith('/**')) return norm.startsWith(glob.slice(0, -3));
  return false;
}
