/**
 * `@frank/adapter-collaboration-channels` — Channels collaboration adapter.
 *
 * CH-02 (FRANK-§8E, M4): the Postgres-backed StateStore for the channel
 * runtime. CH-03: the TelegramChannelAdapter implements `ChannelPort` over a
 * Bot-API transport (long-polling, M1) using that store for durable
 * registrations. The channel surface is never an authority (ADR-022); every
 * button tap is relayed to Frank as a command envelope.
 */

export {
  PostgresStateStore,
  createPostgresStateStore,
  type PostgresStateStoreConfig,
} from './state-store.js';

export {
  TelegramChannelAdapter,
  PLATFORM,
  type TelegramChannelAdapterOptions,
  type DecisionRegistrationRecord,
} from './telegram/adapter.js';

export {
  HttpTelegramTransport,
  type TelegramTransport,
  type TelegramInlineButton,
  type TelegramSendMessageOptions,
  type TelegramUpdate,
  type TelegramUser,
} from './telegram/transport.js';

export {
  renderDecisionCard,
  type RenderedDecisionCard,
} from './telegram/render-html.js';

export {
  renderDecisionCardIR,
  decisionCardPropsFromRequest,
  blocksToEvidenceLines,
  DECISION_CARD_COMPONENT,
  MAX_EVIDENCE_LINES,
  type DecisionCardButton,
  type DecisionCardProps,
} from './telegram/card.js';

export {
  TELEGRAM_TOKEN_PATTERN,
  REDACTED_PLACEHOLDER,
  redactSecret,
  redactLine,
  createRedactingConsole,
  type RedactingConsole,
} from './secrets.js';
