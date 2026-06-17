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



  it('builds redacted OTA misuse events for table and aggregate structured argument shapes', () => {
    const selectEvent = otaMisuseEventForToolError('query_table', { workspace_id: 'genesis', path: 'data.csv', select: { raw: 'secret-select' } }, 'string array must be an array');
    expect(selectEvent?.misuse).toMatchObject({ error_code: 'query_table_select_shape', bad_field: 'select', bad_field_type: 'object', expected_shape_id: 'query_table.select_array.v1', hint_id: 'use_select_array' });
    expect(JSON.stringify(selectEvent)).not.toContain('secret-select');

    const whereEvent = otaMisuseEventForToolError('query_table', { workspace_id: 'genesis', path: 'data.csv', where: ['secret-where'] }, 'where must be an object');
    expect(whereEvent?.misuse).toMatchObject({ error_code: 'query_table_where_shape', bad_field: 'where', bad_field_type: 'array', expected_shape_id: 'query_table.where_object.v1', hint_id: 'use_where_object' });
    expect(JSON.stringify(whereEvent)).not.toContain('secret-where');

    const metricsEvent = otaMisuseEventForToolError('query_table_aggregate', { workspace_id: 'genesis', path: 'data.csv', metrics: { raw: 'secret-metrics' } }, 'metrics must be an array');
    expect(metricsEvent?.misuse).toMatchObject({ error_code: 'query_table_aggregate_metrics_shape', bad_field: 'metrics', bad_field_type: 'object', expected_shape_id: 'query_table_aggregate.metrics_array.v1', hint_id: 'use_metrics_array' });
    expect(JSON.stringify(metricsEvent)).not.toContain('secret-metrics');
  });

  it('builds redacted OTA misuse events for patch and table update shapes', () => {
    const patchEvent = otaMisuseEventForToolError('patch_file_lines', { workspace_id: 'genesis', path: 'notes.txt', replacement: { raw: 'secret-patch' } }, 'replacement is required');
    expect(patchEvent?.misuse).toMatchObject({ error_code: 'patch_file_lines_replacement_shape', bad_field: 'replacement', bad_field_type: 'object', expected_shape_id: 'patch_file_lines.replacement_string.v1', hint_id: 'use_replacement_string' });
    expect(JSON.stringify(patchEvent)).not.toContain('secret-patch');

    const updateEvent = otaMisuseEventForToolError('update_table_rows', { workspace_id: 'genesis', path: 'data.csv', where: ['secret-update'], set: { status: 'ok' } }, 'where must be an object');
    expect(updateEvent?.misuse).toMatchObject({ error_code: 'update_table_rows_where_shape', bad_field: 'where', bad_field_type: 'array', expected_shape_id: 'update_table_rows.where_object.v1', hint_id: 'use_where_object' });
    expect(JSON.stringify(updateEvent)).not.toContain('secret-update');
  });

  it('builds redacted OTA misuse events for run_command argv variants', () => {
    const missingEvent = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis' }, 'cmd_array must be an array');
    expect(missingEvent?.misuse).toMatchObject({ error_code: 'run_command_cmd_array_shape', bad_field: 'cmd_array', bad_field_type: 'undefined', expected_shape_id: 'run_command.argv.v1', hint_id: 'use_cmd_array' });

    const itemEvent = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis', cmd_array: ['echo', { raw: 'secret-cmd' }] }, 'array item is required');
    expect(itemEvent?.misuse).toMatchObject({ error_code: 'run_command_cmd_array_shape', bad_field: 'cmd_array', bad_field_type: 'array', expected_shape_id: 'run_command.argv_items_string.v1', hint_id: 'use_cmd_array_of_strings' });
    expect(JSON.stringify(itemEvent)).not.toContain('secret-cmd');

    const conflictEvent = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis', cmd_array: ['echo', 'safe'], cmd: ['echo', 'different'] }, 'cmd_array/cmd conflict: prefer cmd_array and remove legacy cmd, or send identical arrays for compatibility.');
    expect(conflictEvent?.misuse).toMatchObject({ error_code: 'run_command_cmd_array_shape', bad_field: 'cmd_array', expected_shape_id: 'run_command.single_argv_field.v1', hint_id: 'remove_legacy_cmd_or_match_cmd_array' });
  });

  it('builds redacted OTA misuse events for process operation argument shapes', () => {
    const startEvent = otaMisuseEventForToolError('start_process', { workspace_id: 'genesis', command: { raw: 'secret-command' } }, 'command is required');
    expect(startEvent?.misuse).toMatchObject({ error_code: 'start_process_command_shape', bad_field: 'command', bad_field_type: 'object', expected_shape_id: 'start_process.command_string.v1', hint_id: 'use_command_string' });
    expect(JSON.stringify(startEvent)).not.toContain('secret-command');

    const writeEvent = otaMisuseEventForToolError('write_process', { workspace_id: 'genesis', process_id: 123, input: { raw: 'secret-input' } }, 'process_id is required');
    expect(writeEvent?.misuse).toMatchObject({ error_code: 'write_process_process_id_shape', bad_field: 'process_id', bad_field_type: 'number', expected_shape_id: 'process.process_id_string.v1', hint_id: 'use_process_id_string' });
    expect(JSON.stringify(writeEvent)).not.toContain('secret-input');
  });

  it('builds redacted OTA misuse events for run_command string cmd errors', () => {
    const event = otaMisuseEventForToolError('run_command', { workspace_id: 'genesis', cmd: 'git status' }, 'cmd must be an array. Use cmd_array.');
    expect(event?.misuse).toMatchObject({ error_code: 'invalid_run_command_shape', bad_field: 'cmd', bad_field_type: 'string', expected_shape_id: 'run_command.argv.v1', hint_id: 'use_cmd_array' });
    expect(event?.sample.value_hashes).toHaveProperty('arguments.cmd');
    expect(JSON.stringify(event)).not.toContain('git status');
  });
});
