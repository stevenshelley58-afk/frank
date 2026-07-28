/**
 * `schema://frank.module/v1` — FRANK-§6.1.
 *
 * A versioned, schema-validated module declaration specifying capabilities,
 * dependencies, data access, UI routes, events, and health checks.
 */

import type { DataClass } from './classification.js';
import type { SemanticVersion } from './common.js';

export type ModuleKind = 'feature' | 'integration' | 'policy' | 'workflow' | 'system';

export interface ModuleUi {
  /** Route paths provided by this module. */
  routes: string[];
  /** Widget identifiers provided by this module. */
  widgets: string[];
}

export interface ModuleEvents {
  /** Event type patterns this module subscribes to. */
  consumes: string[];
  /** Event types this module produces. */
  emits: string[];
}

export interface ModulePermissions {
  /** Permission identifiers required for operation. */
  required: string[];
}

export interface ModuleManifest {
  schema: 'frank.module/v1';
  /**
   * Module identifier in dot-separated lowercase form, e.g. `brain.youtube`.
   * Schema pattern: `^[a-z0-9]+([._-][a-z0-9]+)*$`.
   */
  id: string;
  name: string;
  version: SemanticVersion;
  kind: ModuleKind;
  /** Module dependency specifications with semantic version constraints. */
  depends_on: string[];
  /** Capabilities this module exports to the system. */
  provides: string[];
  /**
   * FRANK-§2.3. Data classification levels this module is approved to process.
   * Schema requires at least one.
   */
  data_scopes: DataClass[];
  ui: ModuleUi;
  events: ModuleEvents;
  permissions: ModulePermissions;
  /**
   * Named health check points that verify module dependencies and critical
   * paths.
   */
  health_checks: string[];
}
