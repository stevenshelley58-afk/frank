/**
 * `schema://frank.pack/v1` — FRANK-§6.10.
 *
 * A versioned extension pack for customer or industry-specific modules,
 * configurations, and workflows. A pack may extend schemas through declared
 * extension tables and JSON Schema fields. It may not fork core tables, bypass
 * policy, read another cell, or replace canonical identity and audit.
 */

import type { SemanticVersion } from './common.js';

export type PackRecovery = 'restore-prior-compatible-pack' | 'manual-intervention';

export interface PackEvents {
  /** Event types introduced by this pack. */
  owns: string[];
  /** Core event types this pack subscribes to. */
  consumes: string[];
}

/** FRANK-§6.10. Tables and data extensions owned by this pack. */
export interface PackDataOwnership {
  /**
   * Extension table identifiers owned by this pack. A pack may not fork core
   * tables.
   */
  tables: string[];
  /**
   * If `true`, pack data persists when the pack is disabled. If `false`, data
   * is archived per `uninstall_options`.
   */
  retained_on_disable: boolean;
}

/**
 * Behavior when the pack is disabled.
 * `stop-triggers-and-hide-write-actions` is the default.
 */
export type PackDisableBehavior = 'stop-triggers-and-hide-write-actions' | 'retain-read-only';

/** Pack data handling options available during uninstall. */
export type PackUninstallOption = 'retain-read-only' | 'export-and-delete' | 'migrate';

export interface PackManifest {
  schema: 'frank.pack/v1';
  /**
   * Pack identifier in dot-separated form, e.g. `industry.real-estate`.
   * Schema pattern: `^[a-z0-9]+([._-][a-z0-9]+)*$`.
   */
  id: string;
  version: SemanticVersion;
  /**
   * FRANK core version constraint required by this pack, using semantic
   * versioning range syntax.
   */
  requires_core: string;
  /**
   * Single namespace prefix for all identifiers introduced by this pack,
   * preventing collisions. Schema pattern: `^[a-z0-9_]+$`.
   */
  namespace: string;
  license: string;
  /** Cryptographic signature verifying pack integrity and origin. */
  signature?: string;
  /**
   * Additional permission scopes this pack requires beyond its modules.
   */
  permissions: string[];
  /** Schema identifier for pack-specific configuration options. */
  configuration_schema: string;
  /** Module identifiers (with versions) included or extended by this pack. */
  modules: string[];
  /** New role definitions specific to this pack's workflow. */
  roles: string[];
  /** Workflow identifiers provided by this pack. */
  workflows: string[];
  /** Domain-specific terms and labels introduced by this pack. */
  terminology: Record<string, string>;
  /** Navigation menu structure and section additions. */
  navigation: Record<string, unknown>;
  /** UI extension points where pack components integrate. */
  ui_slots: string[];
  /** Policy document identifiers defined by this pack. */
  policies: string[];
  /** Connector identifiers provided by this pack. */
  connectors: string[];
  /** Report template identifiers provided by this pack. */
  reports: string[];
  events: PackEvents;
  /** Migration identifiers to run when activating this pack. */
  migrations: string[];
  data_ownership: PackDataOwnership;
  disable_behavior: PackDisableBehavior;
  /** Handler identifier for exporting pack-specific data. */
  export_handler: string;
  /** Schema requires at least one option. */
  uninstall_options: PackUninstallOption[];
  /**
   * Recovery strategy if the pack experiences critical failure:
   * `restore-prior-compatible-pack` or `manual-intervention`.
   *
   * The schema documents exactly two values but types the field as an open
   * `string` with `minLength: 1` rather than an `enum`, unlike every other
   * closed vocabulary in these contracts (`disable_behavior` right above it is
   * an enum). This type mirrors the schema, so a typo is accepted here and
   * would only be caught downstream. That is a schema bug, not a modelling
   * choice.
   */
  recovery: PackRecovery;
  /** Test fixture identifiers for acceptance testing. */
  fixtures: string[];
  /** Acceptance test suite identifiers for this pack. */
  acceptance_suites: string[];
}
