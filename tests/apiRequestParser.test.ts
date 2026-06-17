import { describe, expect, it } from 'vitest';
import { parseApiToolRequest, parseApiToolRequestSafe } from '../src/server/http.js';

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

});
