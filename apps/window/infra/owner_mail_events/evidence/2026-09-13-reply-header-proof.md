# Owner reply header-only proof, 2026-09-13

Read-only verification against the retained controlled reply. No body or raw header values were fetched into logs or this document.

- Native Communication: `vruuue6hlo`
- Native source: Email Account `Blockwise Owner Inbox`, INBOX UID `11`
- Native direction and route: received Email to `hello@blockwise.sale`
- Stored INBOX UIDVALIDITY: `1286881107`
- Live mailbox UIDVALIDITY: exact match
- IMAP command scope: one UID, `BODY.PEEK[HEADER]`, read-only INBOX
- Header bytes returned: `1481`
- Raw From: exact controlled Mautic contact 3 address
- Raw To: includes the owner inbox and exactly matches the signed native recipients
- Raw `In-Reply-To`: present
- Raw `References`: present
- Reply identity proof hash prefix: `8222f1c9e245`
- Raw `Auto-Submitted`, `Precedence`, and `List-Id`: absent
- Raw `Date`: absent
- Raw `Message-ID`: absent
- Native `communication_date`: present
- Native `message_id`: empty
- Native `in_reply_to`: empty
- Communication DocType `email_headers` field: absent

Frappe reads raw `In-Reply-To` and `References` while importing mail, but stores `Communication.in_reply_to` only when the referenced message resolves to a native parent Communication. The Mautic-originated parent is not a native Communication, so the reply headers are not retained on this record.

The receiver therefore validates the signed native account, UID, sender, recipients, direction, and communication date, then reads only that immutable mailbox UID's headers. It refuses a changed UIDVALIDITY, mismatched source identity, missing reply headers, automated/list/bulk/report signals, or a Date/Message-ID mismatch when those raw headers exist.
