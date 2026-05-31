import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { READ_ONLY, WRITE_FILE } from './annotations.js';
import { deleteFileTool, deletePathTool, editFileTool, listDir, readBinaryFileTool, readFileTool, statPath, treeTool, workspaceInventory, writeBinaryFileTool, writeFileTool } from '../../tools/files.js';
import { searchFiles } from '../../tools/search.js';
import type { RegisterContext } from './types.js';

export function registerFileTools(context: RegisterContext): void {
  registerReadTools(context);
  registerWriteTools(context);
  registerSearchTools(context);
}

function registerReadTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('workspace_inventory', workspaceInventoryTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'workspace_inventory',
    (workspace) => workspaceInventory(config, workspace, args.max_entries)
  ));
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
  server.registerTool('read_binary_file', readBinaryFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'read_binary_file',
    (workspace) => readBinaryFileTool(config, workspace, args.path)
  ));
}

function registerWriteTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('write_file', writeFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'write_file',
    (workspace) => writeFileTool(config, workspace, args.path, args.content, args.overwrite)
  ));
  server.registerTool('write_binary_file', writeBinaryFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'write_binary_file',
    (workspace) => writeBinaryFileTool(config, workspace, args.path, args.base64, args.overwrite)
  ));
  server.registerTool('edit_file', editFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'edit_file',
    (workspace) => editFileTool(config, workspace, args.path, args.old_text, args.new_text)
  ));
  server.registerTool('delete_file', deleteFileSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'delete_file',
    (workspace) => deleteFileTool(config, workspace, args.path)
  ));
  server.registerTool('delete_path', deletePathSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'delete_path',
    (workspace) => deletePathTool(config, workspace, args.path, args.recursive)
  ));
}

function registerSearchTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('search_files', searchFilesSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'search_files',
    (workspace) => searchFiles(config, workspace, args.query, args.path)
  ));
}

function workspaceInventoryTool() {
  return {
    title: 'Workspace inventory',
    description: 'List a bounded workspace inventory with names and metadata only, including protected/sensitive-looking entries without reading their contents.',
    inputSchema: { workspace_id: z.string(), max_entries: z.number().optional() },
    annotations: READ_ONLY
  };
}

function listDirTool() {
  return {
    title: 'List directory',
    description: 'List files in a workspace directory.',
    inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() },
    annotations: READ_ONLY
  };
}

function statPathTool() {
  return {
    title: 'Stat path',
    description: 'Return file metadata for a workspace path.',
    inputSchema: { workspace_id: z.string(), path: z.string() },
    annotations: READ_ONLY
  };
}

function treeToolSpec() {
  return {
    title: 'Tree',
    description: 'Return a bounded recursive tree for a workspace directory.',
    inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() },
    annotations: READ_ONLY
  };
}

function readFileSpec() {
  return {
    title: 'Read file',
    description: 'Read a text file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), start_line: z.number().optional(), max_lines: z.number().optional() },
    annotations: READ_ONLY
  };
}

function readBinaryFileSpec() {
  return {
    title: 'Read binary file',
    description: 'Read a bounded binary file inside a workspace as base64 with metadata.',
    inputSchema: { workspace_id: z.string(), path: z.string() },
    annotations: READ_ONLY
  };
}

function writeFileSpec() {
  return {
    title: 'Write file',
    description: 'Create or overwrite a UTF-8 text file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), content: z.string(), overwrite: z.boolean().default(false) },
    annotations: WRITE_FILE
  };
}

function writeBinaryFileSpec() {
  return {
    title: 'Write binary file',
    description: 'Create or overwrite a bounded binary file from base64 content inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), base64: z.string(), overwrite: z.boolean().default(false) },
    annotations: WRITE_FILE
  };
}

function editFileSpec() {
  return {
    title: 'Edit file',
    description: 'Replace one exact text occurrence inside a UTF-8 workspace file.',
    inputSchema: { workspace_id: z.string(), path: z.string(), old_text: z.string(), new_text: z.string() },
    annotations: WRITE_FILE
  };
}

function deleteFileSpec() {
  return {
    title: 'Delete file',
    description: 'Delete one regular file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string() },
    annotations: WRITE_FILE
  };
}

function deletePathSpec() {
  return {
    title: 'Delete path',
    description: 'Delete a file or, with recursive=true, a directory inside a workspace. Refuses to delete the workspace root.',
    inputSchema: { workspace_id: z.string(), path: z.string(), recursive: z.boolean().default(false) },
    annotations: WRITE_FILE
  };
}

function searchFilesSpec() {
  return {
    title: 'Search files',
    description: 'Search text in workspace files.',
    inputSchema: { workspace_id: z.string(), query: z.string(), path: z.string().default('.') },
    annotations: READ_ONLY
  };
}
