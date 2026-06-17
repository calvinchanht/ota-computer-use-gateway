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


  it('builds redacted OTA misuse events for common filesystem/text argument shapes', () => {
    const pathEvent = otaMisuseEventForToolError('read_file', { workspace_id: 'genesis', path: 123 }, 'path is required');
    expect(pathEvent?.misuse).toMatchObject({ error_code: 'read_file_path_shape', bad_field: 'path', bad_field_type: 'number', expected_shape_id: 'filesystem.path_string.v1', hint_id: 'use_path_string' });
    expect(pathEvent?.sample.value_hashes).toHaveProperty('arguments.path');

    const writeEvent = otaMisuseEventForToolError('write_file', { workspace_id: 'genesis', path: 'notes.txt', content: { raw: 'secret-ish' } }, 'content must be a string; received object.');
    expect(writeEvent?.misuse).toMatchObject({ error_code: 'write_file_content_shape', bad_field: 'content', bad_field_type: 'object', expected_shape_id: 'write_file.content_string.v1', hint_id: 'use_content_string' });
    expect(JSON.stringify(writeEvent)).not.toContain('secret-ish');
  });


  it('builds redacted OTA misuse events for browser and CUA argument shapes', () => {
    const cdpParamsEvent = otaMisuseEventForToolError('browser_cdp_call', { workspace_id: 'genesis', target_id: 'tab-1', method: 'Runtime.evaluate', params: 'alert-secret' }, 'params must be an object');
    expect(cdpParamsEvent?.misuse).toMatchObject({ error_code: 'browser_cdp_call_params_shape', bad_field: 'params', bad_field_type: 'string', expected_shape_id: 'browser_cdp_call.params_object.v1', hint_id: 'use_params_object' });
    expect(JSON.stringify(cdpParamsEvent)).not.toContain('alert-secret');

    const batchEvent = otaMisuseEventForToolError('cua_driver_batch', { workspace_id: 'genesis', calls: [{ params: { raw: 'hidden' } }] }, 'calls[0].method is required');
    expect(batchEvent?.misuse).toMatchObject({ error_code: 'cua_driver_batch_calls_shape', bad_field: 'calls', bad_field_type: 'array', expected_shape_id: 'cua_driver_batch.calls_method_string.v1', hint_id: 'use_call_method_string' });
    expect(JSON.stringify(batchEvent)).not.toContain('hidden');
  });

  it('builds redacted OTA misuse events for search/query argument shapes', () => {
    const event = otaMisuseEventForToolError('search_files', { workspace_id: 'genesis', root: '.', query: { contains: 'private' } }, 'query is required');
    expect(event?.misuse).toMatchObject({ error_code: 'search_files_query_shape', bad_field: 'query', bad_field_type: 'object', expected_shape_id: 'search_files.query_string.v1', hint_id: 'use_query_string' });
    expect(JSON.stringify(event)).not.toContain('private');
  });

  it('builds redacted OTA misuse events for run_command string cmd errors', () => {
    const event = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis', cmd: 'git status' }, 'cmd must be an array. Use cmd_array.');
    expect(event?.misuse).toMatchObject({ error_code: 'invalid_run_command_shape', bad_field: 'cmd', bad_field_type: 'string', expected_shape_id: 'run_command.argv.v1', hint_id: 'use_cmd_array' });
    expect(event?.sample.value_hashes).toHaveProperty('arguments.cmd');
    expect(JSON.stringify(event)).not.toContain('git status');
  });
});
