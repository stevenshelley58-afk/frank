/**
 * FRANK Tool Provider Protocol.
 *
 * Mirrors the adapter seam Frank's control plane uses for external systems:
 * Frank's control plane talks to an external tool source through this interface
 * alone, and the source underneath is hot-swappable. A `ToolProvider` discovers
 * and invokes tools; today the one implementation is Zapier's MCP server, but a
 * later in-process tool registry or a different MCP host implements the same
 * shape without the kernel changing.
 *
 * ## Tools are proposals, not actions
 *
 * FRANK-§6.9: "Models may propose envelopes but cannot sign, widen, or approve
 * them." A `ToolProvider` is on the proposing side of that line. {@link callTool}
 * is the mechanical execution against the external system; it does NOT itself
 * build, sign, or evaluate an action envelope. The composition root
 * (`apps/api`) decides, per call, to route through the action boundary first —
 * this package never imports `@frank/policy` and cannot bypass it. The
 * {@link ToolDescriptor.actionBoundary} metadata is exactly what the boundary
 * needs to build an envelope; carrying it on the descriptor (rather than
 * inferring it at call time) is what keeps the boundary the single seam.
 *
 * ## Trust
 *
 * Everything that comes back from an external tool is untrusted input. Descriptors
 * and results are stamped `external-untrusted` (FRANK-§2.3) by the provider; the
 * kernel treats recalled tool output the same way it treats any generated content
 * — evidence to assess, never instructions to obey.
 */

import type {
  ActionClass,
  DataClass,
  NetworkScope,
  TrustLabel,
} from '@frank/contracts';

/**
 * The action-boundary metadata the composition root needs to route a tool call
 * through FRANK-§6.9. Deliberately a subset of what an envelope requires — the
 * boundary fills in signing, nonces, budgets, and expiry; the provider only
 * declares the *shape* of the action a tool performs.
 */
export interface ToolActionBoundary {
  /** FRANK-§6.9 / §7.6. What class of action this tool performs. */
  readonly actionClass: ActionClass;
  /**
   * FRANK-§2.3. The strictest data class this tool is approved to read or write.
   * The boundary refuses a call whose payload exceeds it.
   */
  readonly maximumDataClass: DataClass;
  /**
   * FRANK-§15.6. Egress this tool needs. `none` for pure reads served from the
   * MCP host; an allowlist for anything that reaches a third-party API.
   */
  readonly networkScope: NetworkScope;
  /** The resource kind this tool acts on, for the envelope's `target`. */
  readonly targetKind: string;
}

/**
 * One discoverable tool. The shape is MCP's `tools/list` entry plus Frank's
 * boundary metadata, so a provider can map the wire format onto Frank's own
 * vocabulary without the caller knowing MCP exists.
 */
export interface ToolDescriptor {
  /** Stable tool id, e.g. `gmail.send_email`. Unique within a provider. */
  readonly name: string;
  /** Human-readable label for review surfaces. */
  readonly title: string;
  /** What the tool does, for the model and for the reviewer. */
  readonly description: string;
  /**
   * JSON Schema for the tool's arguments, as advertised by the MCP server.
   * Opaque to Frank — validation happens at the boundary and on the server.
   */
  readonly inputSchema: Record<string, unknown>;
  /** FRANK-§6.9 routing metadata. See {@link ToolActionBoundary}. */
  readonly actionBoundary: ToolActionBoundary;
}

/** The outcome of a {@link ToolProvider.callTool}. */
export interface ToolResult {
  /** Whether the external call itself succeeded. Distinct from policy allow/deny. */
  readonly ok: boolean;
  /** Structured content returned by the tool. Empty when `ok` is false. */
  readonly content: readonly ToolResultContent[];
  /** Present when `ok` is false. Human- and machine-readable. */
  readonly error?: string;
  /** FRANK-§2.3: trust stamp for everything in `content`. Always untrusted here. */
  readonly trust: TrustLabel;
}

/** One block of tool output. Mirrors MCP's content block union, minimally. */
export interface ToolResultContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string;
  /** For `image`: a data URL or remote URL. */
  readonly uri?: string;
  readonly mimeType?: string;
}

/** Health report for a provider, mirroring an external adapter's status(). */
export interface ToolProviderStatus {
  readonly healthy: boolean;
  readonly version?: string;
  readonly toolCount?: number;
  /** Set when the provider is misconfigured (e.g. missing env). */
  readonly reason?: string;
}

/**
 * The tool provider protocol.
 *
 * One instance per external tool source. Discovery is lazy — {@link listTools}
 * may hit the network — and {@link callTool} is a single request/response. The
 * provider owns authentication to the external system; Frank owns everything
 * above it (policy, audit, memory).
 */
export interface ToolProvider {
  /** Human-readable source name: "Zapier MCP", etc. */
  readonly name: string;

  /** Discover the tools this source exposes. May cache. */
  listTools(): Promise<readonly ToolDescriptor[]>;

  /**
   * Invoke one tool by name with validated arguments.
   *
   * This is the mechanical external call. It assumes the caller has already
   * routed the action through the boundary — the provider neither checks nor
   * cares about policy, which is the whole point of keeping them separate.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;

  /** Health check. Never throws; reports misconfiguration in-band. */
  status(): Promise<ToolProviderStatus>;
}
