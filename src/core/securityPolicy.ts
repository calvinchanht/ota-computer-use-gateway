import { environmentFilteringEnabled, resultSanitizationEnabled, secretContentHeuristicsEnabled, secretValueRedactionEnabled, type AppConfig } from '../config/schema.js';
import type { Workspace } from './workspaces.js';

export type ChildEnvironmentMode = 'full' | 'minimal';

export function workspaceChildEnvironmentMode(config: AppConfig, workspace: Workspace): ChildEnvironmentMode {
  if (environmentFilteringEnabled(config)) return 'minimal';
  return isAdministrativeWorkspace(workspace) ? 'full' : 'minimal';
}

export function isAdministrativeWorkspace(workspace: Workspace): boolean {
  return workspace.api_sets?.machine_admin === true || workspace.api_sets?.estate_admin === true;
}

export function contentHeuristicsEnabled(config: AppConfig): boolean {
  return secretContentHeuristicsEnabled(config);
}

export function sanitizeResultsEnabled(config: AppConfig): boolean {
  return resultSanitizationEnabled(config);
}

export function redactSecretValuesEnabled(config: AppConfig): boolean {
  return secretValueRedactionEnabled(config);
}
