export type WriteMode = 'create' | 'overwrite' | 'append' | 'patch';

export function recordArg(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

export function requiredTextArg(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value === 'string' && (allowEmpty || value.length > 0)) return value;
  throw new Error(textArgError(value, name, allowEmpty));
}

export function requiredNumber(value: unknown, name: string): number {
  const number = optionalNumber(value);
  if (number === undefined) throw new Error(`${name} is required`);
  return number;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalWriteMode(value: unknown): WriteMode | undefined {
  if (value === undefined) return undefined;
  if (value === 'create' || value === 'overwrite' || value === 'append' || value === 'patch') return value;
  throw new Error('mode must be one of create, overwrite, append, patch');
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, 'string value');
}

export function optionalStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return requiredStringArray(value, 'string array');
}

export function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => requiredString(item, 'array item'));
}

export function runCommandCmdArray(args: Record<string, unknown>): string[] {
  const preferred = args.cmd_array;
  const legacy = args.cmd;
  if (typeof legacy === 'string') throw new Error('cmd must be an array. Use cmd_array: ["git", "status", "--short"]. If shell behavior is intentional, call get_tool_profile or get_workspace_policy and use command_runtime.recommended_cmd_array_for_shell.');
  if (preferred !== undefined && legacy !== undefined) return reconcileCommandArrays(preferred, legacy);
  if (preferred !== undefined) return requiredStringArray(preferred, 'cmd_array');
  return requiredStringArray(legacy, 'cmd_array');
}

export function arrayRecordArg(value: unknown, name: string): Array<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => stringifyRecord(recordArg(item, name) ?? {}));
}

export function stringRecordArg(value: unknown, name: string): Record<string, string> {
  return stringifyRecord(recordArg(value, name) ?? {});
}

function textArgError(value: unknown, name: string, allowEmpty: boolean): string {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const empty = value === '' && !allowEmpty ? ' Empty string is not allowed for this field.' : '';
  const hint = ' If this is structured JSON, serialize it once into a string before sending. Use write_binary_file with base64 for escaping-sensitive exact bytes.';
  return `${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}; received ${type}.${empty}${hint}`;
}

function reconcileCommandArrays(preferred: unknown, legacy: unknown): string[] {
  const preferredArray = requiredStringArray(preferred, 'cmd_array');
  const legacyArray = requiredStringArray(legacy, 'cmd');
  if (JSON.stringify(preferredArray) !== JSON.stringify(legacyArray)) throw new Error('cmd_array/cmd conflict: prefer cmd_array and remove legacy cmd, or send identical arrays for compatibility.');
  return preferredArray;
}

function stringifyRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, val]) => [key, String(val)]));
}
