/**
 * `schema://frank.screen/v1` — FRANK-§3.8.
 *
 * A machine-readable contract for every user-facing screen. A route absent from
 * the registry cannot ship. Duplicate paths, undeclared commands, missing
 * authorization, missing state coverage, inaccessible primary actions, and pack
 * route collisions fail CI. URLs contain only opaque identifiers, never secrets
 * or sensitive labels.
 */

/**
 * Navigation placement: `primary` (top-level), `contextual` (within object), or
 * `detail` (specific record view).
 */
export type ScreenNavigation = 'primary' | 'contextual' | 'detail';

export type ScreenRole = 'owner' | 'operator' | 'builder' | 'member' | 'reviewer' | 'service';

/** FRANK-§3.7 and §3.8. Every UI state a screen must implement. */
export type ScreenState =
  | 'loading'
  | 'empty'
  | 'partial'
  | 'stale'
  | 'offline'
  | 'denied'
  | 'degraded'
  | 'error'
  | 'recovery'
  | 'success';

/**
 * FRANK-§3.7. Offline handling strategy: `read-cached` (serve stale data),
 * `sync-on-connect` (queue updates), or `none` (disable offline).
 */
export type ScreenOffline = 'read-cached' | 'sync-on-connect' | 'none';

/** FRANK-§3.7. Platform capabilities a screen may require. */
export type ScreenCapability =
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'filesystem'
  | 'native-bridge'
  | 'push'
  | 'share-target';

export type DeepLinkPlatform = 'web' | 'pwa' | 'tauri';

export interface ScreenContract {
  schema: 'frank.screen/v1';
  /**
   * Unique screen identifier in dot-separated form.
   * Schema pattern: `^[a-z0-9]+([._-][a-z0-9]+)*$`.
   */
  id: string;
  /**
   * FRANK-§3.8. URL path for this screen. Must contain only opaque identifiers,
   * never secrets or sensitive labels. Use route parameters like `:id` for
   * opaque resource identifiers only.
   */
  path: string;
  navigation: ScreenNavigation;
  /**
   * FRANK-§3.8 and §2.2. Authorized roles. Missing authorization fails CI.
   * Schema requires at least one.
   */
  roles: ScreenRole[];
  /**
   * Data compartment identifiers this screen respects (project, room, cell
   * scope, etc). An empty array means no compartment filtering.
   */
  compartments: string[];
  /**
   * FRANK-§3.8. Primary object types shown on this screen. Missing state
   * coverage for an object fails CI. Schema requires at least one.
   */
  objects: string[];
  /** Schema identifier for the query parameters accepted by this screen. */
  query_schema: string;
  /**
   * FRANK-§3.8. Command identifiers that may be invoked from this screen.
   * Undeclared commands fail CI.
   */
  commands: string[];
  /** Event type patterns that trigger live updates on this screen. */
  event_parts: string[];
  /** Schema requires at least one state. */
  states: ScreenState[];
  offline: ScreenOffline;
  capabilities: ScreenCapability[];
  /** Schema requires at least one platform. */
  deep_links: DeepLinkPlatform[];
  /**
   * FRANK-§3.7. Versioned acceptance test journeys that exercise this screen.
   */
  acceptance_journeys: string[];
}
