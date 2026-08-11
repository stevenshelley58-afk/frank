/**
 * FRANK-§2.2 role model and the server-side authorization matrix.
 *
 * FRANK-§2.1: "Steven is the owner, administrator, operator, and primary user."
 * FRANK-§2.2: "The authorization model **must support these roles even though
 * Steven's cell initially assigns them to one person**."
 *
 * So the six roles are real values here in Slice 1, not a TODO. A single-user
 * deployment that hard-codes "the one user may do everything" has to be
 * rewritten the first time a second principal exists, and — more to the point —
 * FRANK's own agents and services are *already* non-owner principals. The
 * service identity that runs the enrichment loop is a `service_identity` today,
 * not later.
 *
 * ## The matrix is data, and it is keyed by operation
 *
 * FRANK-§3.8: "**Server authorization never trusts the client route or
 * manifest.**" That sentence rules out one very natural design — a table from
 * screen id or URL path to allowed roles — because both of those are things the
 * client says. {@link ROLE_CAPABILITIES} is keyed by *operation*: the same
 * vocabulary the policy engine's operation catalogue uses, derived on the server
 * from the route the server itself matched, never from a header, a body field,
 * or a manifest.
 *
 * `authorize()` in `authorize.ts` accordingly has no parameter that could carry
 * a route.
 */

/** FRANK-§2.2, verbatim, in the specification's order. */
export const ROLES = [
  'owner',
  'operator',
  'builder',
  'member',
  'reviewer',
  'service_identity',
] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set<string>(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/** The FRANK-§2.2 "Scope" column, kept next to the role it describes. */
export const ROLE_SCOPES: Readonly<Record<Role, string>> = {
  owner:
    'Identity recovery, policies, billing, export, deletion, production promotion, and global containment.',
  operator:
    'Infrastructure, connectors, model pools, backups, incident response, and upgrades.',
  builder: 'Project work, repositories, sandboxes, tests, and previews.',
  member: 'Personal work and allowed shared spaces.',
  reviewer: 'Evidence review and narrowly delegated promotion decisions.',
  service_identity: 'A non-human principal with explicit capability and time limits.',
};

/**
 * A capability is an operation from the shared catalogue. Slice 1 implements a
 * subset; an operation absent from {@link ROLE_CAPABILITIES} is denied to every
 * role, including `owner`.
 *
 * That last clause is deliberate and is the fail-closed rule applied to
 * authorization: an operation nobody has thought about is not automatically the
 * owner's. It is nobody's until a row says otherwise.
 */
export type Capability =
  | 'source.capture'
  | 'work.read'
  | 'work.create'
  | 'work.transition'
  | 'work.assign'
  | 'today.read'
  | 'provenance.read'
  | 'system.health.read'
  | 'system.health.read.detailed'
  | 'brain.search.read'
  | 'brain.entry.write'
  | 'chat.read'
  | 'chat.write';

/**
 * Which roles may request which operation.
 *
 * Read as: "a principal holding any of these roles passes the *identity* gate
 * for this operation." Passing it is necessary and never sufficient — the
 * FRANK-§6.9 policy engine still evaluates the action envelope afterwards, and
 * FRANK-§15.5.6 puts it in that order on purpose ("apply policy after the model
 * proposes an action"). Identity says who may ask; policy says whether this
 * particular asking is allowed.
 */
export const ROLE_CAPABILITIES: Readonly<Record<Capability, readonly Role[]>> = {
  // UX-003: capture is the one thing every principal in the cell can do, because
  // a capture is an inert immutable record — it authorizes nothing by existing.
  'source.capture': ['owner', 'operator', 'builder', 'member', 'service_identity'],
  'work.read': ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  'work.create': ['owner', 'operator', 'builder', 'member', 'service_identity'],
  // WORK-004 transitions change state. A reviewer reviews; it does not drive.
  'work.transition': ['owner', 'operator', 'builder', 'member', 'service_identity'],
  'work.assign': ['owner', 'operator', 'builder', 'member'],
  'today.read': ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  // The provenance walk is the audit surface; a reviewer needs it by definition
  // (FRANK-§2.2: "Evidence review").
  'provenance.read': ['owner', 'operator', 'builder', 'member', 'reviewer'],
  // Liveness/readiness is unauthenticated at the transport (a load balancer
  // cannot hold a session); the *detailed* view is not.
  'system.health.read': ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  'system.health.read.detailed': ['owner', 'operator'],
  'brain.search.read': ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  'brain.entry.write': ['owner', 'operator', 'builder', 'member', 'service_identity'],
  // The chat shell. A service identity writes here too: a room's Frank appends
  // its own turns, working cards and receipts to the conversation it was given.
  'chat.read': ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  'chat.write': ['owner', 'operator', 'builder', 'member', 'service_identity'],
};

const CAPABILITY_SET: ReadonlySet<string> = new Set<string>(Object.keys(ROLE_CAPABILITIES));

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/**
 * True when any of `roles` grants `capability`.
 *
 * `Object.prototype.hasOwnProperty` rather than a bare index so a capability
 * named `constructor` or `__proto__` cannot resolve to something inherited —
 * the same prototype-pollution guard the policy engine's catalogue uses.
 */
export function rolesGrant(roles: readonly Role[], capability: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, capability)) return false;
  const permitted = ROLE_CAPABILITIES[capability as Capability];
  return roles.some((role) => permitted.includes(role));
}

/** Every capability `roles` grants, sorted. For the `_links`/commands surface. */
export function capabilitiesOf(roles: readonly Role[]): readonly Capability[] {
  return (Object.keys(ROLE_CAPABILITIES) as Capability[])
    .filter((capability) => rolesGrant(roles, capability))
    .sort();
}
