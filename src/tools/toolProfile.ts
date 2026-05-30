import { ok } from '../core/result.js';

export function toolProfile() {
  return ok('tool profile', {
    profile: 'mcp_explicit',
    naming: 'descriptive snake_case canonical tool names',
    canonical_tools: canonicalTools(),
    aliases: aliases(),
    deprecated_tools: deprecatedTools(),
    skill_layouts: ['.agents/skills/<skill>/SKILL.md', '.agent/skills/<skill>/SKILL.md'],
    project_instructions: ['AGENTS.md', 'AGENTS.override.md']
  });
}

function canonicalTools(): string[] {
  return [
    'list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_tab_info',
    'open_browser_tab', 'activate_browser_tab', 'close_browser_tab', 'computer_status', 'observe_screen',
    'read_file', 'write_file', 'read_binary_file', 'write_binary_file', 'edit_file', 'apply_patch',
    'run_command', 'run_configured_command', 'list_dir', 'search_files',
    'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process',
    'get_context_snapshot', 'get_agent_bootstrap', 'list_skills', 'read_skill',
    'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread'
  ];
}

function aliases(): Record<string, string> {
  return {
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    Bash: 'run_command',
    Shell: 'run_command',
    Grep: 'search_files',
    Glob: 'list_dir',
    exec: 'run_command'
  };
}

function deprecatedTools(): Record<string, string> {
  return {
    exec: 'run_command',
    process_start: 'start_process',
    process_list: 'list_processes',
    process_log: 'read_process',
    process_kill: 'stop_process'
  };
}
