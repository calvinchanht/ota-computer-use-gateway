import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { editFileTool, listDir, readFileTool, statPath, treeTool, writeFileTool } from '../../tools/files.js';
import { searchFiles } from '../../tools/search.js';
import type { RegisterContext } from './types.js';

export function registerFileTools(context: RegisterContext): void {
  registerReadTools(context);
  registerWriteTools(context);
  registerSearchTools(context);
}

function registerReadTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('list_dir', listDirTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'list_dir',
    (workspace) => listDir(config, workspace, args.path, args.max_entries)
  ));
  server.registerTool('stat_path', statPathTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'stat_path',
    (workspace) => statPath(config, workspace, args.path)
  ));
  server.registerTool('tree', treeToolSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'tree',
    (workspace) => treeTool(config, workspace, args.path, args.max_entries)
  ));
  server.registerTool('read_file', readFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'read_file',
    (workspace) => readFileTool(config, workspace, args.path, args.start_line, args.max_lines)
  ));
}

function registerWriteTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('write_file', writeFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'write_file',
    (workspace) => writeFileTool(config, workspace, args.path, args.content, args.overwrite)
  ));
  server.registerTool('edit_file', editFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'edit_file',
    (workspace) => editFileTool(config, workspace, args.path, args.old_text, args.new_text)
  ));
}

function registerSearchTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('search_files', searchFilesSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'search_files',
    (workspace) => searchFiles(config, workspace, args.query, args.path)
  ));
}

function listDirTool() {
  return {
    title: 'List directory',
    description: 'List files in a workspace directory.',
    inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() }
  };
}

function statPathTool() {
  return {
    title: 'Stat path',
    description: 'Return file metadata for a workspace path.',
    inputSchema: { workspace_id: z.string(), path: z.string() }
  };
}

function treeToolSpec() {
  return {
    title: 'Tree',
    description: 'Return a bounded recursive tree for a workspace directory.',
    inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() }
  };
}

function readFileSpec() {
  return {
    title: 'Read file',
    description: 'Read a text file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), start_line: z.number().optional(), max_lines: z.number().optional() }
  };
}

function writeFileSpec() {
  return {
    title: 'Write file',
    description: 'Create or overwrite a UTF-8 text file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), content: z.string(), overwrite: z.boolean().default(false) }
  };
}

function editFileSpec() {
  return {
    title: 'Edit file',
    description: 'Replace one exact text occurrence inside a UTF-8 workspace file.',
    inputSchema: { workspace_id: z.string(), path: z.string(), old_text: z.string(), new_text: z.string() }
  };
}

function searchFilesSpec() {
  return {
    title: 'Search files',
    description: 'Search text in workspace files.',
    inputSchema: { workspace_id: z.string(), query: z.string(), path: z.string().default('.') }
  };
}
