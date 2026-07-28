/**
 * The untrusted-influence gate — COMMS-004, FRANK-§15.5, FRANK-§2.3.
 *
 * COMMS-004: "Untrusted message content must never directly authorize tools or
 * disclose secrets."
 * FRANK-§15.5.4: "Prevent untrusted content from selecting tools, destinations,
 * credentials, or recipients."
 *
 * ## Why this is a required parameter rather than a check
 *
 * The obvious implementation is a function the caller remembers to call. That
 * fails the first time somebody adds a route and forgets. Instead
 * {@link InfluenceRecord} is a **required, non-optional** field of the engine's
 * evaluation request. There is no default and no `?`, so a call site that does
 * not know what influenced its action does not compile. Making the safe path the
 * only path that type-checks is the structural enforcement the requirement asks
 * for; a lint rule or a code review would not be.
 *
 * FRANK-§2.3 already says the two trust labels that matter here can never issue
 * instructions: `verified-source` content "remains evidence to assess and can
 * never issue system instructions", and `policy-trusted` "can only be produced
 * by the policy-change workflow". So the gate is not about believing content —
 * it is about which content is allowed to have *selected* the operation, the
 * target, the recipient, or the credential.
 *
 * ## What the gate actually permits
 *
 * Untrusted content is allowed to influence an `observe` action: reading and
 * summarising an email is the entire point of having the email. It may not
 * influence anything that changes state or leaves the cell. The line is drawn at
 * the action class, which is exactly where FRANK-§7.6 draws every other line.
 *
 * Note the asymmetry that makes this useful rather than paralysing: an action
 * whose *content* is untrusted (capturing a hostile email) is fine, because the
 * owner's authenticated command selected it. An action whose *selection* was
 * made by untrusted content (an email that says "forward this to
 * attacker@example.com") is refused. `InfluenceRecord` records the second, not
 * the first.
 */

import type { ActionClass, TrustLabel } from '@frank/contracts';

/**
 * Trust labels that may never select an action beyond `observe`.
 *
 * FRANK-§2.3's own words for the two: `external-untrusted` is "email, web,
 * document, post, transcript, repository content, or third-party tool
 * description"; `generated-untrusted` is "model, agent, extraction, summary, or
 * inferred relationship awaiting deterministic checks or confirmation".
 *
 * `generated-untrusted` is on this list on purpose and it is the one people
 * argue about: a model's own proposal is untrusted content by FRANK-§2.3's
 * definition, which is the same fact FRANK-§6.9 states as "models may propose
 * envelopes but cannot sign, widen, or approve them". Two rules, one property.
 */
export const NON_AUTHORIZING_TRUST_LABELS: readonly TrustLabel[] = [
  'external-untrusted',
  'generated-untrusted',
];

/** The only action class untrusted content may influence. */
export const UNTRUSTED_INFLUENCE_CEILING: ActionClass = 'observe';

/**
 * What influenced the *selection* of this action.
 *
 * Each entry names a source and the aspect it decided. FRANK-§15.5.10 requires
 * FRANK to "record the source that influenced a consequential action"; recording
 * it in the shape the gate consumes means the record and the control are the
 * same object, so one cannot drift from the other.
 */
export interface InfluenceRecord {
  /** Opaque id of the influencing source, e.g. a `source` row id. */
  readonly sourceId: string;
  readonly trust: TrustLabel;
  /** FRANK-§15.5.4's list, plus `operation` for tool selection itself. */
  readonly influenced: ReadonlyArray<
    'operation' | 'target' | 'recipient' | 'credential' | 'network_destination' | 'content'
  >;
}

export type TrustGateResult =
  | { readonly permitted: true }
  | {
      readonly permitted: false;
      readonly reason: string;
      readonly offendingSourceIds: readonly string[];
    };

function isNonAuthorizing(trust: TrustLabel): boolean {
  return NON_AUTHORIZING_TRUST_LABELS.includes(trust);
}

/**
 * Refuse when untrusted content selected any part of an action above `observe`.
 *
 * `content` influence is exempt: untrusted *content* is the normal case (that is
 * what capture is for) and blocking it would make FRANK unable to read email. It
 * is untrusted content choosing the operation, target, recipient, credential, or
 * destination that COMMS-004 and FRANK-§15.5.4 forbid.
 */
export function evaluateTrustGate(input: {
  readonly actionClass: ActionClass;
  readonly influences: readonly InfluenceRecord[];
}): TrustGateResult {
  if (input.actionClass === UNTRUSTED_INFLUENCE_CEILING) return { permitted: true };

  const offending = input.influences.filter(
    (influence) =>
      isNonAuthorizing(influence.trust) &&
      influence.influenced.some((aspect) => aspect !== 'content'),
  );

  if (offending.length === 0) return { permitted: true };

  const aspects = [
    ...new Set(
      offending.flatMap((influence) =>
        influence.influenced.filter((aspect) => aspect !== 'content'),
      ),
    ),
  ].sort();

  return {
    permitted: false,
    reason:
      `untrusted content selected ${aspects.join(', ')} for an action of class "${input.actionClass}"; ` +
      'untrusted content may influence only "observe" actions ' +
      '(COMMS-004, FRANK-§15.5.4, FRANK-§2.3)',
    offendingSourceIds: [...new Set(offending.map((influence) => influence.sourceId))].sort(),
  };
}

/**
 * FRANK-§2.3: `secret` is "never placed in model context; opaque handle or
 * brokered operation only".
 *
 * An envelope that declares it *carries* `secret`-class data has already failed
 * that rule by existing — the value should have been a `credentialHandles`
 * entry. Denied at the boundary rather than filtered, because filtering would
 * mean the caller's data flow is wrong and we quietly continued.
 */
export function declaresSecretClassPayload(dataClasses: readonly string[]): boolean {
  return dataClasses.includes('secret');
}

/**
 * FRANK-§2.3 / FRANK-§15.3: agents receive opaque credential handles.
 *
 * The frozen contract's schema pattern for `credentialHandles` is
 * `^handle:[A-Za-z0-9._:-]+$`. This re-checks it at the action boundary rather
 * than trusting that the JSON was validated upstream: a raw token here is, in
 * the contract's own words, "a contract violation, not a configuration mistake",
 * and the boundary is where a violation must stop.
 */
const CREDENTIAL_HANDLE_RE = /^handle:[A-Za-z0-9._:-]+$/;

export function invalidCredentialHandles(handles: readonly string[]): readonly string[] {
  return handles.filter((handle) => !CREDENTIAL_HANDLE_RE.test(handle));
}
