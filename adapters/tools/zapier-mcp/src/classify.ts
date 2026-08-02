/**
 * Maps raw MCP tool entries onto Frank's three supported Google families —
 * Gmail, Google Calendar, Google Tasks — and assigns each a
 * {@link ToolActionBoundary}.
 *
 * The mapping is deliberately conservative: a tool we cannot classify is not
 * exposed at all, rather than exposed with a guessed action class. FRANK-§7.6
 * holds anything uncovered, and a misclassified tool would let a destructive
 * action slip under a reversible class. So unknown tools are dropped by
 * {@link classifyTool} and never reach the kernel.
 *
 * ## How classification works
 *
 * Zapier MCP tool names are dotted and verb-led, e.g. `gmail.send_email`,
 * `google_calendar.create_event`, `google_tasks.create_task`. We classify on
 * (family, verb) and fall back to a read/write split for verbs we recognise but
 * have no bespoke rule for: anything that reads is `observe`, anything that
 * writes reversibly is `internal_reversible`, and sending mail (external,
 * recipient-visible) is `external_reversible`.
 */

import type {
  ActionClass,
  DataClass,
  NetworkScope,
} from '@frank/contracts';
import type { McpTool } from './mcp-client.js';
import type { ToolActionBoundary, ToolDescriptor } from './types.js';

/** The three Google families this adapter is authorised to expose. */
export type GoogleFamily = 'gmail' | 'google_calendar' | 'google_tasks';

/** Network scope for calls that reach Google's APIs via the MCP host. */
const GOOGLE_EGRESS: NetworkScope = {
  mode: 'allowlist',
  allowedHosts: ['zapier.com', 'googleapis.com', 'google.com'],
};

/**
 * Gmail content is private (other people's messages); Calendar and Tasks are
 * internal to the owner. These are the *maximum* classes — a read of a public
 * calendar is still capped at the family ceiling, never widened.
 */
const FAMILY_DATA_CLASS: Record<GoogleFamily, DataClass> = {
  gmail: 'private',
  google_calendar: 'internal',
  google_tasks: 'internal',
};

const FAMILY_TARGET_KIND: Record<GoogleFamily, string> = {
  gmail: 'gmail.message',
  google_calendar: 'google_calendar.event',
  google_tasks: 'google_tasks.task',
};

const READ_VERBS = [
  'get',
  'list',
  'search',
  'find',
  'read',
  'fetch',
  'view',
  'draft', // drafting is not sending — still reversible, but classified below
];

/**
 * Detect the Google family from an MCP tool name, and how many leading
 * dot/underscore tokens that family consumed. Returns `null` for anything
 * outside the three supported families — those tools are never exposed.
 *
 * The token count lets {@link verbOf} skip past the family prefix: `google`
 * `calendar` is two tokens, `gmail` is one, so the verb is never at a fixed
 * index.
 */
export function familyOf(toolName: string): { family: GoogleFamily; prefixTokens: number } | null {
  const tokens = toolName.toLowerCase().split(/[._]/);
  const first = tokens[0] ?? '';
  const second = tokens[1] ?? '';

  if (first === 'gmail') return { family: 'gmail', prefixTokens: 1 };
  if (first === 'calendar') return { family: 'google_calendar', prefixTokens: 1 };
  if (first === 'tasks') return { family: 'google_tasks', prefixTokens: 1 };
  if (first === 'google' && second === 'calendar') {
    return { family: 'google_calendar', prefixTokens: 2 };
  }
  if (first === 'google' && second === 'tasks') {
    return { family: 'google_tasks', prefixTokens: 2 };
  }
  return null;
}

/**
 * The verb segment of a tool name, normalised to lowercase. The verb is the
 * first token after the family prefix, so `google_calendar.create_event` ->
 * `create` and `gmail.send_email` -> `send`.
 */
function verbOf(toolName: string, prefixTokens: number): string {
  const tokens = toolName.toLowerCase().split(/[._]/);
  const verbToken = tokens[prefixTokens] ?? '';
  // A verb may itself be underscore-joined in a single token (`send_email`
  // stays one token after the split only when written `send-email`); split
  // defensively so `send`/`email` still resolves to `send`.
  return verbToken.split('_')[0] ?? '';
}

/**
 * Classify one tool's action class from its verb. Sending anything to a
 * recipient is external; reads are observe; recognised writes are reversible.
 * Returns `null` when the verb is unrecognised — the caller drops the tool.
 */
function actionClassFor(verb: string): ActionClass | null {
  if (verb === 'send' || verb === 'reply' || verb === 'forward') {
    return 'external_reversible';
  }
  if (verb === 'delete' || verb === 'remove' || verb === 'trash') {
    // Reversible on Google (trash/undo), but treated as the heavier reversible
    // class so the boundary records intent. Still not destructive_or_privileged.
    return 'internal_reversible';
  }
  if (READ_VERBS.includes(verb)) {
    return 'observe';
  }
  if (
    verb === 'create' ||
    verb === 'update' ||
    verb === 'edit' ||
    verb === 'add' ||
    verb === 'set' ||
    verb === 'complete' ||
    verb === 'move' ||
    verb === 'patch'
  ) {
    return 'internal_reversible';
  }
  return null;
}

/**
 * Classify a raw MCP tool into a Frank {@link ToolDescriptor}, or `null` if it
 * is outside the supported families or its verb is unrecognised.
 */
export function classifyTool(tool: McpTool): ToolDescriptor | null {
  const detected = familyOf(tool.name);
  if (detected === null) return null;
  const { family, prefixTokens } = detected;

  const verb = verbOf(tool.name, prefixTokens);
  const actionClass = actionClassFor(verb);
  if (actionClass === null) return null;

  const boundary: ToolActionBoundary = {
    actionClass,
    maximumDataClass: FAMILY_DATA_CLASS[family],
    // Every call egresses to the MCP host regardless of read/write; the
    // allowlist names the host and the Google APIs it fronts. `none` would be a
    // false claim that the action contacts nothing (FRANK-§15.6).
    networkScope: GOOGLE_EGRESS,
    targetKind: FAMILY_TARGET_KIND[family],
  };

  return {
    name: tool.name,
    title: tool.title ?? humanise(tool.name),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    actionBoundary: boundary,
  };
}

/** `gmail.send_email` -> `Gmail Send Email`, for review surfaces. */
function humanise(toolName: string): string {
  return toolName
    .split(/[._]/)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ');
}
