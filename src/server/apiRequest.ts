type ApiToolRequest = { tool: string; arguments?: Record<string, unknown> };

export type ApiShapeErrorBody = { ok: false; error: string; error_code: string; message: string; expected?: unknown; accepted_aliases?: Record<string, string>; received_top_level_keys?: string[]; received_argument_keys?: string[]; hint?: string };

class ApiShapeError extends Error {
  constructor(readonly body: ApiShapeErrorBody) {
    super(body.message);
  }
}

export function parseApiToolRequestSafe(body: unknown): { ok: true; value: ApiToolRequest } | { ok: false; status: number; body: ApiShapeErrorBody } {
  try {
    return { ok: true, value: parseApiToolRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, body: apiShapeErrorBody(error) };
  }
}

export function parseApiBatchRequestSafe(body: unknown): { ok: true; value: { steps: ApiToolRequest[] } } | { ok: false; status: number; body: ApiShapeErrorBody } {
  try {
    return { ok: true, value: parseApiBatchRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, body: apiShapeErrorBody(error) };
  }
}

function apiShapeErrorBody(error: unknown): ApiShapeErrorBody {
  if (error instanceof ApiShapeError) return error.body;
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: 'invalid_gateway_request_shape', error_code: 'invalid_gateway_request_shape', message };
}

export function parseApiToolRequest(body: unknown): ApiToolRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const source = body as Record<string, unknown>;
  const topOperation = requestOperation(source.operation, source.tool);
  const args = requestArguments(source);
  const nestedOperation = !topOperation && args ? requestOperation(args.operation, args.tool) : undefined;
  const operation = topOperation ?? nestedOperation;
  if (!operation) throw expectedRequestError(source, args);
  const normalizedArgs = nestedOperation && args ? omitOperationKeys(args) : args;
  return { tool: operation, arguments: normalizedArgs };
}

function parseApiBatchRequest(body: unknown): { steps: ApiToolRequest[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const steps = (body as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) throw expectedBatchRequestError(body as Record<string, unknown>);
  return { steps: steps.map((step) => parseApiToolRequest(step)) };
}

function requestOperation(operation: unknown, tool: unknown): string | undefined {
  const op = optionalOperationString(operation, 'operation');
  const legacy = optionalOperationString(tool, 'tool');
  if (op && legacy && op !== legacy) throw new Error(`operation/tool conflict: operation=${op}, tool=${legacy}`);
  return op ?? legacy;
}

function optionalOperationString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requestArguments(source: Record<string, unknown>): Record<string, unknown> | undefined {
  if (source.arguments !== undefined) return recordArg(source.arguments, 'arguments');
  const args = omitEnvelopeKeys(source);
  return Object.keys(args).length > 0 ? args : undefined;
}

function omitEnvelopeKeys(source: Record<string, unknown>): Record<string, unknown> {
  const args = { ...source };
  delete args.operation;
  delete args.tool;
  delete args.idempotency_key;
  delete args.thread;
  return args;
}

function omitOperationKeys(source: Record<string, unknown>): Record<string, unknown> {
  const args = { ...source };
  delete args.operation;
  delete args.tool;
  return args;
}

function expectedRequestError(source: Record<string, unknown>, args?: Record<string, unknown>): ApiShapeError {
  const topKeys = Object.keys(source);
  const argKeys = args ? Object.keys(args) : [];
  const message = `Missing required operation. Expected { "operation": "estate_bootstrap", "arguments": { "workspace_id": "genesis" } }. Received top-level keys: [${topKeys.join(', ') || '(none)'}], argument keys: [${args ? argKeys.join(', ') || '(none)' : '(missing)'}]. Legacy alias "tool" is still accepted.`;
  return new ApiShapeError({
    ok: false,
    error: 'invalid_gateway_request_shape',
    error_code: 'invalid_gateway_request_shape',
    message,
    expected: { operation: 'estate_bootstrap', arguments: { workspace_id: 'genesis' } },
    accepted_aliases: { tool: 'legacy alias for operation' },
    received_top_level_keys: topKeys,
    received_argument_keys: argKeys,
    hint: 'Put the operation name at top level and workspace_id inside arguments.'
  });
}

function expectedBatchRequestError(source: Record<string, unknown>): ApiShapeError {
  return new ApiShapeError({
    ok: false,
    error: 'invalid_gateway_request_shape',
    error_code: 'invalid_gateway_request_shape',
    message: 'steps must be an array',
    expected: { steps: [{ operation: 'heartbeat', arguments: { workspace_id: 'genesis' } }] },
    accepted_aliases: { tool: 'legacy alias for operation inside each step' },
    received_top_level_keys: Object.keys(source),
    hint: 'Send steps as an array of { operation, arguments } objects.'
  });
}

function recordArg(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
