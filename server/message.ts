// The normalized message every ingestion path stores, whatever it arrived through. The dashboard,
// /api and MCP only ever see these shapes.

export interface Header {
  name: string;
  value: string;
}

export interface NewAttachment {
  filename: string | null;
  contentType: string | null;
  /** Set for inline parts referenced as cid:… in the HTML. */
  contentId: string | null;
  disposition: "attachment" | "inline";
  /** null when the sender only gave a URL (Resend `path`), which is recorded, never fetched. */
  content: Uint8Array | null;
  url: string | null;
}

export interface NewMessage {
  mailbox: string;
  /** Which way in: a provider name ("resend") or "smtp". */
  provider: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  /** The SMTP envelope (MAIL FROM, RCPT TO), which can differ from the headers. */
  envelope: { from: string | null; to: string[] } | null;
  subject: string;
  html: string | null;
  text: string | null;
  headers: Header[];
  /** The RFC 5322 Message-ID. */
  messageId: string | null;
  /** ISO time the sender asked for. Stored and shown; the message is visible straight away. */
  scheduledAt: string | null;
  attachments: NewAttachment[];
  /** Original source, for SMTP. */
  raw: Uint8Array | null;
  /** What the provider needs to answer its own API exactly (Resend: tags, template, last_event…). */
  providerData: Record<string, unknown>;
}

export interface AttachmentInfo {
  id: string;
  filename: string | null;
  contentType: string | null;
  contentId: string | null;
  disposition: "attachment" | "inline";
  size: number;
  url: string | null;
}

export interface MessageSummary {
  id: string;
  mailbox: string;
  provider: string;
  createdAt: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  attachmentCount: number;
  scheduledAt: string | null;
}

export interface Message extends MessageSummary {
  bcc: string[];
  replyTo: string[];
  envelope: { from: string | null; to: string[] } | null;
  html: string | null;
  text: string | null;
  headers: Header[];
  messageId: string | null;
  attachments: AttachmentInfo[];
  hasRaw: boolean;
  size: number;
  providerData: Record<string, unknown>;
}

export const DEFAULT_MAILBOX = "default";

/**
 * A mailbox name from a credential: an API key (`re_slot3` → `slot3`) or an SMTP username.
 * Anything empty lands in `default`.
 */
export function mailboxFromCredential(
  value: string | null | undefined,
  prefix = "",
): string {
  let v = (value ?? "").trim();
  if (prefix && v.startsWith(prefix)) v = v.slice(prefix.length);
  return normalizeMailbox(v);
}

export function normalizeMailbox(name: string): string {
  const v = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return v || DEFAULT_MAILBOX;
}
