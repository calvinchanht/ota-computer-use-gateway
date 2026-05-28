const SECRET_PATTERNS = [/OPENAI_API_KEY/i, /AWS_SECRET_ACCESS_KEY/i, /GITHUB_TOKEN/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /Bearer\s+[A-Za-z0-9._-]{20,}/];

export function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactSecrets(text: string): string {
  return text.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]');
}
