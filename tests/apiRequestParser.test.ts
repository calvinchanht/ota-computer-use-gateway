import { describe, expect, it } from 'vitest';
import { otaMisuseEventForApiShapeError, otaMisuseEventForToolError, parseApiToolRequest, parseApiToolRequestSafe } from '../src/server/http.js';

describe('HTTP API request normalizer', () => {
  it('accepts operation as the canonical public field', () => {
    expect(parseApiToolRequest({
      operation: 'genesis_bootstrap',
      arguments: { workspace_id: 'genesis' }
    })).toEqual({ tool: 'genesis_bootstrap', arguments: { workspace_id: 'genesis' } });
  });

  it('keeps legacy tool as a compatibility alias', () => {
    expect(parseApiToolRequest({
      tool: 'heartbeat',
      arguments: {}
    })).toEqual({ tool: 'heartbeat', arguments: {} });
  });

  it('hoists top-level business arguments when intent is clear', () => {
    expect(parseApiToolRequest({
      tool: 'genesis_bootstrap',
      workspace_id: 'genesis'
    })).toEqual({ tool: 'genesis_bootstrap', arguments: { workspace_id: 'genesis' } });
  });

  it('hoists a misplaced nested tool from arguments', () => {
    expect(parseApiToolRequest({
      arguments: { tool: 'genesis_bootstrap', workspace_id: 'genesis' }
    })).toEqual({ tool: 'genesis_bootstrap', arguments: { workspace_id: 'genesis' } });
  });

  it('rejects conflicting operation and tool aliases', () => {
    expect(() => parseApiToolRequest({
      operation: 'heartbeat',
      tool: 'workspace_status',
      arguments: {}
    })).toThrow(/operation\/tool conflict/);
  });

  it('returns an instructional missing-operation error', () => {
    expect(() => parseApiToolRequest({ arguments: { workspace_id: 'genesis' } }))
      .toThrow(/Expected \{ "operation": "genesis_bootstrap"/);
  });

  it('returns compact structured correction fields for missing operation', () => {
    expect(parseApiToolRequestSafe({ arguments: { workspace_id: 'genesis' } })).toMatchObject({
      ok: false,
      status: 400,
      body: {
        ok: false,
        error_code: 'invalid_gateway_request_shape',
        expected: { operation: 'genesis_bootstrap', arguments: { workspace_id: 'genesis' } },
        accepted_aliases: { tool: 'legacy alias for operation' },
        received_argument_keys: ['workspace_id'],
        hint: 'Put the operation name at top level and workspace_id inside arguments.'
      }
    });
  });


  it('builds redacted OTA misuse events for invalid API tool shape errors', () => {
    const safe = parseApiToolRequestSafe({ arguments: { workspace_id: 'genesis' } });
    expect(safe.ok).toBe(false);
    if (safe.ok) throw new Error('expected parse failure');
    const event = otaMisuseEventForApiShapeError('/api/v1/tool', { arguments: { workspace_id: 'genesis' } }, safe.body, 'ota.api_tool_request.v1', 'use_operation_arguments_shape');
    expect(event.misuse).toMatchObject({ error_code: 'invalid_gateway_request_shape', expected_shape_id: 'ota.api_tool_request.v1', hint_id: 'use_operation_arguments_shape' });
    expect(event.source.workspace_id).toBe('genesis');
    expect(JSON.stringify(event)).not.toMatch(/Bearer|secret|token/i);
  });

  it('builds redacted OTA misuse events for run_command string cmd errors', () => {
    const event = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis', cmd: 'git status' }, 'cmd must be an array. Use cmd_array.');
    expect(event?.misuse).toMatchObject({ error_code: 'invalid_run_command_shape', bad_field: 'cmd', bad_field_type: 'string', expected_shape_id: 'run_command.argv.v1', hint_id: 'use_cmd_array' });
    expect(event?.sample.value_hashes).toHaveProperty('arguments.cmd');
    expect(JSON.stringify(event)).not.toContain('git status');
  });
});
