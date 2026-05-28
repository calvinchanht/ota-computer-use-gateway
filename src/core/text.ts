export function truncateText(text: string, maxBytes: number) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}
