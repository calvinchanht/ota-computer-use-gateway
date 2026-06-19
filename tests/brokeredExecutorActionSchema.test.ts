import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const actionSchemaPaths = [
  'docs/examples/action-openapi.template.yaml',
  'docs/examples/mickey-api-action-openapi.yaml',
  'docs/examples/hkerbot-api-action-openapi.yaml',
  'docs/examples/boba-api-action-openapi.yaml',
  'docs/examples/catalyst-api-action-openapi.yaml'
];

describe('brokered executor Action schema gating', () => {
  it('does not expose brokered executor paths in default generated Action schemas', async () => {
    for (const schemaPath of actionSchemaPaths) {
      const text = await readFile(schemaPath, 'utf8');
      expect(text, `${schemaPath} should not expose executor job routes by default`).not.toContain('/ota/api/v1/executor-jobs');
      expect(text, `${schemaPath} should not expose executor worker routes by default`).not.toContain('/ota/api/v1/executors/');
      expect(text, `${schemaPath} should not expose executor implementation paths`).not.toMatch(/executor_(claim|heartbeat|complete|fail)/);
    }
  });
});
