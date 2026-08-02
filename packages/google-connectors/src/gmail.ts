/**
 * Gmail connector — full bidirectional. listEmail, searchEmail, getEmail,
 * draftEmail, sendEmail, modifyEmailLabels.
 *
 * Outbound mail is built as a minimal RFC-2822 MIME message and uploaded via
 * the raw (base64url) representation, which Gmail accepts for both send and
 * draft. This avoids a mime library dependency while supporting text + HTML.
 */
import { google, type gmail_v1 } from "googleapis";
import { getAuthClient } from "./auth.js";
import { toConnectorError } from "./errors.js";
import type {
  DraftEmailParams,
  EmailAddress,
  EmailMessage,
  EmailMessageSummary,
  GetEmailParams,
  ListEmailParams,
  ListEmailResult,
  ModifyEmailLabelsParams,
  SearchEmailParams,
  SearchEmailResult,
  SendEmailParams,
  SendEmailResult,
} from "./types.js";

function gmailClient() {
  return google.gmail({ version: "v1" });
}

const USER = "me";

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------

function encodeHeaderValue(value: string): string {
  // RFC-2047 encode non-ASCII header values; leave ASCII untouched.
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function buildRawMessage(params: {
  to: readonly string[];
  subject: string;
  body: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  htmlBody?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers: string[] = [];
  headers.push(`To: ${params.to.join(", ")}`);
  if (params.cc !== undefined && params.cc.length > 0) headers.push(`Cc: ${params.cc.join(", ")}`);
  if (params.bcc !== undefined && params.bcc.length > 0) headers.push(`Bcc: ${params.bcc.join(", ")}`);
  headers.push(`Subject: ${encodeHeaderValue(params.subject)}`);
  headers.push("MIME-Version: 1.0");
  if (params.inReplyTo !== undefined) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references !== undefined) headers.push(`References: ${params.references}`);

  if (params.htmlBody !== undefined) {
    const boundary = `frank_alt_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      params.body,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      params.htmlBody,
      `--${boundary}--`,
    ];
    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  }

  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: quoted-printable");
  return headers.join("\r\n") + "\r\n\r\n" + params.body;
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Header / body parsing
// ---------------------------------------------------------------------------

function parseAddress(raw: string | undefined): EmailAddress | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const match = /^(.*?)(<[^>]+>)?$/.exec(raw.trim());
  const bracket = match?.[2];
  if (bracket !== undefined && bracket.length > 0) {
    const address = bracket.slice(1, -1).trim();
    const name = match?.[1]?.trim().replace(/^"|"$/g, "");
    return name !== undefined && name.length > 0 ? { name, address } : { address };
  }
  return { address: raw.trim() };
}

function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((part) => parseAddress(part))
    .filter((a): a is EmailAddress => a !== undefined);
}

function getHeader(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string | undefined {
  const headers = payload?.headers ?? [];
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? undefined;
}

function decodeBodyPart(part: gmail_v1.Schema$MessagePart | undefined): string {
  const data = part?.body?.data;
  if (data === undefined || data === null) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractBodies(payload: gmail_v1.Schema$MessagePart | undefined): {
  text?: string;
  html?: string;
} {
  if (payload === undefined) return {};
  const mime = payload.mimeType ?? "";
  if (mime === "text/plain") return { text: decodeBodyPart(payload) };
  if (mime === "text/html") return { html: decodeBodyPart(payload) };

  const result: { text?: string; html?: string } = {};
  for (const part of payload.parts ?? []) {
    const nested = extractBodies(part);
    if (result.text === undefined && nested.text !== undefined) result.text = nested.text;
    if (result.html === undefined && nested.html !== undefined) result.html = nested.html;
  }
  return result;
}

function mapSummary(m: gmail_v1.Schema$Message): EmailMessageSummary {
  const base: EmailMessageSummary = {
    id: m.id ?? "",
    threadId: m.threadId ?? "",
    labelIds: m.labelIds ?? [],
  };
  const o = base as { -readonly [K in keyof EmailMessageSummary]: EmailMessageSummary[K] };
  if (m.snippet !== undefined && m.snippet !== null) o.snippet = m.snippet;
  return base;
}

function mapMessage(m: gmail_v1.Schema$Message): EmailMessage {
  const payload = m.payload;
  const labelIds = m.labelIds ?? [];
  const from = parseAddress(getHeader(payload, "From"));
  const bodies = extractBodies(payload);

  const base: EmailMessage = {
    id: m.id ?? "",
    threadId: m.threadId ?? "",
    labelIds,
    to: parseAddressList(getHeader(payload, "To")),
    cc: parseAddressList(getHeader(payload, "Cc")),
    bcc: parseAddressList(getHeader(payload, "Bcc")),
    subject: getHeader(payload, "Subject") ?? "",
    unread: labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
  };

  const o = base as { -readonly [K in keyof EmailMessage]: EmailMessage[K] };
  if (from !== undefined) o.from = from;
  if (m.snippet !== undefined && m.snippet !== null) o.snippet = m.snippet;
  const date = getHeader(payload, "Date");
  if (date !== undefined) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) o.date = parsed.toISOString();
  }
  if (bodies.text !== undefined) o.textBody = bodies.text;
  if (bodies.html !== undefined) o.htmlBody = bodies.html;
  return base;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listEmail(params: ListEmailParams = {}): Promise<ListEmailResult> {
  try {
    const gmail = gmailClient();
    const res = await gmail.users.messages.list({
      auth: await getAuthClient(),
      userId: USER,
      ...(params.labelIds !== undefined && params.labelIds.length > 0
        ? { labelIds: [...params.labelIds] }
        : {}),
      ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
      ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
      ...(params.includeSpamTrash !== undefined ? { includeSpamTrash: params.includeSpamTrash } : {}),
    });

    const result: ListEmailResult = {
      messages: (res.data.messages ?? []).map((m): EmailMessageSummary => mapSummary(m)),
      resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
    };
    const o = result as { -readonly [K in keyof ListEmailResult]: ListEmailResult[K] };
    if (res.data.nextPageToken !== undefined && res.data.nextPageToken !== null) o.nextPageToken = res.data.nextPageToken;
    return result;
  } catch (error) {
    throw toConnectorError(error, "gmail", "listEmail");
  }
}

export async function searchEmail(params: SearchEmailParams): Promise<SearchEmailResult> {
  try {
    const gmail = gmailClient();
    const res = await gmail.users.messages.list({
      auth: await getAuthClient(),
      userId: USER,
      q: params.query,
      ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
      ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
      ...(params.includeSpamTrash !== undefined ? { includeSpamTrash: params.includeSpamTrash } : {}),
    });

    const result: SearchEmailResult = {
      messages: (res.data.messages ?? []).map((m): EmailMessageSummary => mapSummary(m)),
      resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
    };
    const o = result as { -readonly [K in keyof SearchEmailResult]: SearchEmailResult[K] };
    if (res.data.nextPageToken !== undefined && res.data.nextPageToken !== null) o.nextPageToken = res.data.nextPageToken;
    return result;
  } catch (error) {
    throw toConnectorError(error, "gmail", "searchEmail");
  }
}

export async function getEmail(params: GetEmailParams): Promise<EmailMessage> {
  try {
    const gmail = gmailClient();
    const res = await gmail.users.messages.get({
      auth: await getAuthClient(),
      userId: USER,
      id: params.id,
      format: params.format ?? "full",
    });
    return mapMessage(res.data);
  } catch (error) {
    throw toConnectorError(error, "gmail", "getEmail");
  }
}

async function resolveReferences(replyToMessageId: string | undefined): Promise<
  { inReplyTo: string; references: string } | undefined
> {
  if (replyToMessageId === undefined) return undefined;
  try {
    const gmail = gmailClient();
    const res = await gmail.users.messages.get({
      auth: await getAuthClient(),
      userId: USER,
      id: replyToMessageId,
      format: "metadata",
      metadataHeaders: ["Message-Id", "References"],
    });
    const headers = res.data.payload?.headers ?? [];
    const messageId = headers.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? undefined;
    const existingRefs = headers.find((h) => h.name?.toLowerCase() === "references")?.value ?? "";
    if (messageId === undefined) return undefined;
    const references = existingRefs.length > 0 ? `${existingRefs} ${messageId}` : messageId;
    return { inReplyTo: messageId, references };
  } catch {
    return undefined;
  }
}

export async function draftEmail(params: DraftEmailParams): Promise<{ id: string }> {
  try {
    const refs = await resolveReferences(params.replyToMessageId);
    const raw = buildRawMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      ...(params.cc !== undefined ? { cc: params.cc } : {}),
      ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
      ...(params.htmlBody !== undefined ? { htmlBody: params.htmlBody } : {}),
      ...(refs !== undefined ? { inReplyTo: refs.inReplyTo, references: refs.references } : {}),
    });

    const gmail = gmailClient();
    const res = await gmail.users.drafts.create({
      auth: await getAuthClient(),
      userId: USER,
      requestBody: { message: { raw: toBase64Url(raw) } },
    });
    return { id: res.data.id ?? "" };
  } catch (error) {
    throw toConnectorError(error, "gmail", "draftEmail");
  }
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  try {
    const refs = await resolveReferences(params.replyToMessageId);
    const raw = buildRawMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      ...(params.cc !== undefined ? { cc: params.cc } : {}),
      ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
      ...(params.htmlBody !== undefined ? { htmlBody: params.htmlBody } : {}),
      ...(refs !== undefined ? { inReplyTo: refs.inReplyTo, references: refs.references } : {}),
    });

    const gmail = gmailClient();
    const res = await gmail.users.messages.send({
      auth: await getAuthClient(),
      userId: USER,
      requestBody: { raw: toBase64Url(raw) },
    });
    return {
      id: res.data.id ?? "",
      threadId: res.data.threadId ?? "",
      labelIds: res.data.labelIds ?? [],
    };
  } catch (error) {
    throw toConnectorError(error, "gmail", "sendEmail");
  }
}

export async function modifyEmailLabels(params: ModifyEmailLabelsParams): Promise<EmailMessageSummary> {
  try {
    const gmail = gmailClient();
    const res = await gmail.users.messages.modify({
      auth: await getAuthClient(),
      userId: USER,
      id: params.id,
      requestBody: {
        ...(params.addLabelIds !== undefined ? { addLabelIds: [...params.addLabelIds] } : {}),
        ...(params.removeLabelIds !== undefined ? { removeLabelIds: [...params.removeLabelIds] } : {}),
      },
    });
    return mapSummary(res.data);
  } catch (error) {
    throw toConnectorError(error, "gmail", "modifyEmailLabels");
  }
}
