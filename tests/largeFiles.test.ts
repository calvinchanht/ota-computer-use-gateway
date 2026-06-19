import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';
import { inferFileStructure, jsonProfile, patchFileLines, queryJson, queryTable, queryTableAggregate, readAround, readFileChunk, sampleFile, searchFiles, tableProfile, updateTableRows } from '../src/tools/largeFiles.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765, exposed_tools: [] },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('large file tools', () => {
  it('samples, chunks, reads around, and searches files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'logs.txt'), Array.from({ length: 100 }, (_, i) => `line ${i + 1}${i === 41 ? ' needle' : ''}`).join('\n'));
    expect((await sampleFile(config, workspace, 'logs.txt', 'head_tail_random', 3, 3, 3, 5000)).data).toMatchObject({ path: 'logs.txt', total_lines: 100 });
    expect((await readFileChunk(config, workspace, 'logs.txt', 0, 20)).data).toMatchObject({ offset: 0, eof: false });
    expect(JSON.stringify((await readAround(config, workspace, 'logs.txt', 42, 1, 1)).data)).toContain('needle');
    expect(JSON.stringify((await searchFiles(config, workspace, '.', 'needle', '**/*.txt', 5, 1)).data)).toContain('logs.txt');
  });

  it('profiles and queries tables', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'tracker.tsv'), 'Stage\tLane\tFit\nSubmitted\tGames\t8\nRejected\tGames\t4\nSubmitted\tAI\t10\n');
    expect((await inferFileStructure(config, workspace, 'tracker.tsv')).data).toMatchObject({ detected_type: 'tsv' });
    expect(JSON.stringify((await tableProfile(config, workspace, 'tracker.tsv', ['Stage', 'Fit'])).data)).toContain('Submitted');
    expect((await queryTable(config, workspace, 'tracker.tsv', ['Lane', 'Fit'], { Stage: 'Submitted' }, [{ field: 'Fit', direction: 'desc' }], 10)).data).toMatchObject({ total: 2 });
    const aggregate = await queryTableAggregate(config, workspace, 'tracker.tsv', ['Stage'], [{ op: 'count' }, { op: 'avg', column: 'Fit' }]);
    expect(JSON.stringify(aggregate.data)).toContain('avg_Fit');
    const dry = await updateTableRows(config, workspace, 'tracker.tsv', { Lane: 'AI' }, { Stage: 'Interview' }, true);
    expect(dry.data).toMatchObject({ dry_run: true, matched_rows: 1 });
  });

  it('profiles and queries JSON', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'dashboard.json'), JSON.stringify({ stats: { total: 3 }, jobs: [{ id: 'a' }, { id: 'b' }] }));
    expect(JSON.stringify((await jsonProfile(config, workspace, 'dashboard.json', 3, 2)).data)).toContain('jobs');
    expect((await queryJson(config, workspace, 'dashboard.json', '$.jobs[0].id')).data).toMatchObject({ value: 'a' });
    expect((await queryJson(config, workspace, 'dashboard.json', '$.jobs[*].{id:id}')).data).toMatchObject({ value: [{ id: 'a' }, { id: 'b' }] });
  });

  it('patches lines with sha guard', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'a\nb\nc');
    const dry = await patchFileLines(config, workspace, 'note.txt', 2, 2, 'B', undefined, true);
    const hash = (dry.data as any).file_hash_before;
    await patchFileLines(config, workspace, 'note.txt', 2, 2, 'B', hash, false);
    await expect(readFile(path.join(workspace.realRoot, 'note.txt'), 'utf8')).resolves.toBe('a\nB\nc');
  });
});

async function fixtureWorkspace(allowWrite = false): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-large-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: allowWrite, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
