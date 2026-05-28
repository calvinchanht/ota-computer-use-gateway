export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
  truncated?: boolean;
  warnings?: string[];
};

export function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data, truncated: false, warnings: [] };
}

export function fail(summary: string, warnings: string[] = []): ToolResult {
  return { ok: false, summary, truncated: false, warnings };
}

export function asText(result: ToolResult) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}
