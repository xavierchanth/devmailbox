// SQLite storage (bun:sqlite): messages, attachments, mailboxes and provider idempotency records.
// Message order is the autoincrement `seq`; ids are UUIDs and double as pagination cursors.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { htmlToText, snippet } from "./html.ts";
import type {
  AttachmentInfo,
  Message,
  MessageSummary,
  NewMessage,
} from "./message.ts";
import { addressIndex, fold, toSql, type Query, type Searchable } from "./query.ts";

const SCHEMA = `
create table if not exists mailboxes (
  name text primary key,
  created_at text not null
);
create table if not exists messages (
  seq integer primary key autoincrement,
  id text not null unique,
  mailbox text not null,
  provider text not null,
  created_at text not null,
  from_addr text not null,
  to_addrs text not null,
  cc_addrs text not null,
  bcc_addrs text not null,
  reply_to text not null,
  envelope text,
  subject text not null,
  html text,
  text text,
  headers text not null,
  message_id text,
  scheduled_at text,
  provider_data text not null,
  raw blob,
  size integer not null,
  attachment_count integer not null,
  snippet text not null,
  -- query.ts's fields, fold()ed
  search_mailbox text not null,
  search_provider text not null,
  search_from text not null,
  search_to text not null,
  search_from_addrs text not null,
  search_to_addrs text not null,
  search_subject text not null,
  search_body text not null
);
create index if not exists messages_mailbox on messages (mailbox, seq);
create index if not exists messages_provider on messages (provider, mailbox, seq);
create index if not exists messages_created on messages (created_at);
create table if not exists attachments (
  id text primary key,
  message_id text not null references messages (id) on delete cascade,
  position integer not null,
  filename text,
  content_type text,
  content_id text,
  disposition text not null,
  size integer not null,
  content blob,
  url text
);
create index if not exists attachments_message on attachments (message_id, position);
create table if not exists idempotency (
  scope text not null,
  key text not null,
  request_hash text not null,
  status integer not null,
  response text not null,
  created_at text not null,
  primary key (scope, key)
);
`;

interface Row {
  seq: number;
  id: string;
  mailbox: string;
  provider: string;
  created_at: string;
  from_addr: string;
  to_addrs: string;
  cc_addrs: string;
  bcc_addrs: string;
  reply_to: string;
  envelope: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  headers: string;
  message_id: string | null;
  scheduled_at: string | null;
  provider_data: string;
  has_raw: number;
  size: number;
  attachment_count: number;
  snippet: string;
}

interface AttachmentRow {
  id: string;
  filename: string | null;
  content_type: string | null;
  content_id: string | null;
  disposition: "attachment" | "inline";
  size: number;
  url: string | null;
}

const SUMMARY_COLS = `seq, id, mailbox, provider, created_at, from_addr, to_addrs, cc_addrs,
  subject, snippet, attachment_count, scheduled_at`;
const FULL_COLS = `${SUMMARY_COLS}, bcc_addrs, reply_to, envelope, html, text, headers,
  message_id, provider_data, raw is not null as has_raw, size`;

function toSummary(r: Row): MessageSummary {
  return {
    id: r.id,
    mailbox: r.mailbox,
    provider: r.provider,
    createdAt: r.created_at,
    from: r.from_addr,
    to: JSON.parse(r.to_addrs),
    cc: JSON.parse(r.cc_addrs),
    subject: r.subject,
    snippet: r.snippet,
    attachmentCount: r.attachment_count,
    scheduledAt: r.scheduled_at,
  };
}

function toAttachment(a: AttachmentRow): AttachmentInfo {
  return {
    id: a.id,
    filename: a.filename,
    contentType: a.content_type,
    contentId: a.content_id,
    disposition: a.disposition,
    size: a.size,
    url: a.url,
  };
}

/** The fields queries look at, for a message about to be stored. */
export function searchable(m: NewMessage, createdAt: string): Searchable {
  const from = [m.from, m.envelope?.from ?? ""].filter(Boolean);
  const recipients = [...m.to, ...m.cc, ...m.bcc, ...(m.envelope?.to ?? [])];
  return {
    mailbox: m.mailbox,
    provider: m.provider,
    from: from.join("\n"),
    recipients: recipients.join("\n"),
    fromAddresses: addressIndex(from),
    recipientAddresses: addressIndex(recipients),
    subject: m.subject,
    body: m.text ?? (m.html ? htmlToText(m.html) : ""),
    attachments: m.attachments.length,
    createdAt,
  };
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
}

export interface MailboxInfo {
  name: string;
  createdAt: string;
  messages: number;
  lastMessageAt: string | null;
}

export class Store {
  readonly db: Database;

  constructor(dataDir: string) {
    let path = ":memory:";
    if (dataDir !== ":memory:") {
      mkdirSync(dataDir, { recursive: true });
      path = join(dataDir, "devmailbox.db");
    }
    this.db = new Database(path, { create: true });
    this.db.run("pragma journal_mode = wal");
    this.db.run("pragma foreign_keys = on");
    this.db.run("pragma busy_timeout = 5000");
    this.db.run(SCHEMA);
  }

  close() {
    this.db.close();
  }

  insert(m: NewMessage, now = new Date()): { message: Message; searchable: Searchable } {
    const id = crypto.randomUUID();
    const createdAt = now.toISOString();
    const s = searchable(m, createdAt);
    const attachmentBytes = m.attachments.reduce(
      (n, a) => n + (a.content?.byteLength ?? 0),
      0,
    );
    const size =
      m.raw?.byteLength ??
      (m.html?.length ?? 0) + (m.text?.length ?? 0) + attachmentBytes;
    this.db.transaction(() => {
      this.db
        .query(
          "insert into mailboxes (name, created_at) values (?, ?) on conflict do nothing",
        )
        .run(m.mailbox, createdAt);
      this.db
        .query(
          `insert into messages (id, mailbox, provider, created_at, from_addr, to_addrs, cc_addrs,
            bcc_addrs, reply_to, envelope, subject, html, text, headers, message_id, scheduled_at,
            provider_data, raw, size, attachment_count, snippet, search_mailbox, search_provider,
            search_from, search_to, search_from_addrs, search_to_addrs, search_subject, search_body)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          m.mailbox,
          m.provider,
          createdAt,
          m.from,
          JSON.stringify(m.to),
          JSON.stringify(m.cc),
          JSON.stringify(m.bcc),
          JSON.stringify(m.replyTo),
          m.envelope ? JSON.stringify(m.envelope) : null,
          m.subject,
          m.html,
          m.text,
          JSON.stringify(m.headers),
          m.messageId,
          m.scheduledAt,
          JSON.stringify(m.providerData),
          m.raw,
          size,
          m.attachments.length,
          snippet(s.body),
          fold(s.mailbox),
          fold(s.provider),
          fold(s.from),
          fold(s.recipients),
          fold(s.fromAddresses),
          fold(s.recipientAddresses),
          fold(s.subject),
          fold(s.body),
        );
      const att = this.db.query(
        `insert into attachments (id, message_id, position, filename, content_type, content_id,
          disposition, size, content, url) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      m.attachments.forEach((a, i) =>
        att.run(
          crypto.randomUUID(),
          id,
          i,
          a.filename,
          a.contentType,
          a.contentId,
          a.disposition,
          a.content?.byteLength ?? 0,
          a.content,
          a.url,
        ),
      );
    })();
    return { message: this.get(id)!, searchable: s };
  }

  private row(id: string): Row | null {
    return this.db
      .query(`select ${FULL_COLS} from messages where id = ?`)
      .get(id) as Row | null;
  }

  get(id: string): Message | null {
    const r = this.row(id);
    if (!r) return null;
    const attachments = (
      this.db
        .query(
          `select id, filename, content_type, content_id, disposition, size, url
           from attachments where message_id = ? order by position`,
        )
        .all(id) as AttachmentRow[]
    ).map(toAttachment);
    return {
      ...toSummary(r),
      bcc: JSON.parse(r.bcc_addrs),
      replyTo: JSON.parse(r.reply_to),
      envelope: r.envelope ? JSON.parse(r.envelope) : null,
      html: r.html,
      text: r.text,
      headers: JSON.parse(r.headers),
      messageId: r.message_id,
      attachments,
      hasRaw: !!r.has_raw,
      size: r.size,
      providerData: JSON.parse(r.provider_data),
    };
  }

  raw(id: string): Uint8Array | null {
    const r = this.db.query("select raw from messages where id = ?").get(id) as
      | { raw: Uint8Array | null }
      | null;
    return r?.raw ?? null;
  }

  attachment(
    messageId: string,
    attachmentId: string,
  ): { info: AttachmentInfo; content: Uint8Array | null } | null {
    const r = this.db
      .query(
        `select id, filename, content_type, content_id, disposition, size, url, content
         from attachments where message_id = ? and id = ?`,
      )
      .get(messageId, attachmentId) as
      | (AttachmentRow & { content: Uint8Array | null })
      | null;
    return r ? { info: toAttachment(r), content: r.content } : null;
  }

  /** Attachment ids by content id, for rewriting cid: references in HTML. */
  contentIds(messageId: string): Map<string, string> {
    const rows = this.db
      .query(
        "select id, content_id from attachments where message_id = ? and content_id is not null",
      )
      .all(messageId) as Array<{ id: string; content_id: string }>;
    return new Map(rows.map((r) => [r.content_id.replace(/^<|>$/g, ""), r.id]));
  }

  seqOf(id: string): number | null {
    const r = this.db.query("select seq from messages where id = ?").get(id) as
      | { seq: number }
      | null;
    return r?.seq ?? null;
  }

  /** Newest first. `cursor` is a message id: return messages older than it. */
  search(
    q: Query,
    opts: { limit: number; cursor?: string | null; afterSeq?: number },
  ): Page<MessageSummary> {
    const { where, params } = toSql(q);
    const extra: string[] = [];
    const args: Array<string | number> = [...params];
    if (opts.cursor) {
      const seq = this.seqOf(opts.cursor);
      if (seq === null) return { data: [], hasMore: false };
      extra.push("seq < ?");
      args.push(seq);
    }
    if (opts.afterSeq !== undefined) {
      extra.push("seq > ?");
      args.push(opts.afterSeq);
    }
    const rows = this.db
      .query(
        `select ${SUMMARY_COLS} from messages where ${[where, ...extra].join(" AND ")}
         order by seq desc limit ?`,
      )
      .all(...args, opts.limit + 1) as Row[];
    return {
      data: rows.slice(0, opts.limit).map(toSummary),
      hasMore: rows.length > opts.limit,
    };
  }

  /** The newest message matching `q` that arrived after `since` (an ISO time or a message id). */
  newestMatch(q: Query, since: { seq?: number; time?: string }): Message | null {
    const { where, params } = toSql(q);
    const extra: string[] = [];
    const args: Array<string | number> = [...params];
    if (since.seq !== undefined) {
      extra.push("seq > ?");
      args.push(since.seq);
    }
    if (since.time) {
      extra.push("created_at > ?");
      args.push(since.time);
    }
    const r = this.db
      .query(
        `select id from messages where ${[where, ...extra].join(" AND ")} order by seq desc limit 1`,
      )
      .get(...args) as { id: string } | null;
    return r ? this.get(r.id) : null;
  }

  mailboxes(): MailboxInfo[] {
    return (
      this.db
        .query(
          `select b.name, b.created_at, count(m.seq) as messages, max(m.created_at) as last
           from mailboxes b left join messages m on m.mailbox = b.name
           group by b.name order by coalesce(max(m.created_at), b.created_at) desc`,
        )
        .all() as Array<{
        name: string;
        created_at: string;
        messages: number;
        last: string | null;
      }>
    ).map((r) => ({
      name: r.name,
      createdAt: r.created_at,
      messages: r.messages,
      lastMessageAt: r.last,
    }));
  }

  hasMailbox(name: string): boolean {
    return !!this.db.query("select 1 from mailboxes where name = ?").get(name);
  }

  private deleteIds(ids: string[]) {
    const del = this.db.query("delete from messages where id = ?");
    this.db.transaction(() => ids.forEach((id) => del.run(id)))();
  }

  deleteMessage(id: string): MessageSummary | null {
    const r = this.db
      .query(`select ${SUMMARY_COLS} from messages where id = ?`)
      .get(id) as Row | null;
    if (!r) return null;
    this.deleteIds([id]);
    return toSummary(r);
  }

  /** Delete a mailbox and its messages. Returns the deleted message ids, or null if unknown. */
  deleteMailbox(name: string): string[] | null {
    if (!this.hasMailbox(name)) return null;
    const ids = (
      this.db
        .query("select id from messages where mailbox = ?")
        .all(name) as Array<{ id: string }>
    ).map((r) => r.id);
    this.db.transaction(() => {
      this.deleteIds(ids);
      this.db.query("delete from mailboxes where name = ?").run(name);
    })();
    return ids;
  }

  /** Apply retention. Returns what was deleted, per mailbox. */
  sweep(
    retention: { maxMessagesPerMailbox: number; maxAgeHours: number },
    now = new Date(),
    mailbox?: string,
  ): Array<{ mailbox: string; id: string }> {
    const doomed: Array<{ mailbox: string; id: string }> = [];
    if (retention.maxAgeHours > 0) {
      const cutoff = new Date(
        now.getTime() - retention.maxAgeHours * 3_600_000,
      ).toISOString();
      doomed.push(
        ...(this.db
          .query(
            `select mailbox, id from messages where created_at < ?${mailbox ? " and mailbox = ?" : ""}`,
          )
          .all(...(mailbox ? [cutoff, mailbox] : [cutoff])) as Array<{
          mailbox: string;
          id: string;
        }>),
      );
    }
    if (retention.maxMessagesPerMailbox > 0) {
      doomed.push(
        ...(this.db
          .query(
            `select mailbox, id from (
               select mailbox, id, row_number() over (partition by mailbox order by seq desc) as n
               from messages${mailbox ? " where mailbox = ?" : ""}
             ) where n > ?`,
          )
          .all(
            ...(mailbox
              ? [mailbox, retention.maxMessagesPerMailbox]
              : [retention.maxMessagesPerMailbox]),
          ) as Array<{ mailbox: string; id: string }>),
      );
    }
    const unique = [...new Map(doomed.map((d) => [d.id, d])).values()];
    this.deleteIds(unique.map((d) => d.id));
    return unique;
  }

  // ---------- provider-scoped access ----------

  /** A provider's own messages in one mailbox, newest first, with Resend-style cursors. */
  providerList(
    provider: string,
    mailbox: string,
    opts: { limit: number; after?: string; before?: string },
  ): Page<Message> | null {
    const base = "provider = ? and mailbox = ?";
    let rows: Array<{ id: string }>;
    if (opts.before) {
      const seq = this.seqOf(opts.before);
      if (seq === null) return null;
      rows = (
        this.db
          .query(
            `select id from messages where ${base} and seq > ? order by seq asc limit ?`,
          )
          .all(provider, mailbox, seq, opts.limit + 1) as Array<{ id: string }>
      ).reverse();
      const hasMore = rows.length > opts.limit;
      if (hasMore) rows = rows.slice(1);
      return { data: rows.map((r) => this.get(r.id)!), hasMore };
    }
    let seq = Number.MAX_SAFE_INTEGER;
    if (opts.after) {
      const s = this.seqOf(opts.after);
      if (s === null) return null;
      seq = s;
    }
    rows = this.db
      .query(
        `select id from messages where ${base} and seq < ? order by seq desc limit ?`,
      )
      .all(provider, mailbox, seq, opts.limit + 1) as Array<{ id: string }>;
    return {
      data: rows.slice(0, opts.limit).map((r) => this.get(r.id)!),
      hasMore: rows.length > opts.limit,
    };
  }

  providerGet(provider: string, mailbox: string, id: string): Message | null {
    const m = this.get(id);
    return m && m.provider === provider && m.mailbox === mailbox ? m : null;
  }

  setProviderData(
    id: string,
    data: Record<string, unknown>,
    scheduledAt?: string | null,
  ) {
    if (scheduledAt === undefined)
      this.db
        .query("update messages set provider_data = ? where id = ?")
        .run(JSON.stringify(data), id);
    else
      this.db
        .query(
          "update messages set provider_data = ?, scheduled_at = ? where id = ?",
        )
        .run(JSON.stringify(data), scheduledAt, id);
  }

  idempotencyGet(
    scope: string,
    key: string,
    notBefore: string,
  ): { requestHash: string; status: number; response: string } | null {
    const r = this.db
      .query(
        "select request_hash, status, response from idempotency where scope = ? and key = ? and created_at >= ?",
      )
      .get(scope, key, notBefore) as {
      request_hash: string;
      status: number;
      response: string;
    } | null;
    return r
      ? { requestHash: r.request_hash, status: r.status, response: r.response }
      : null;
  }

  idempotencyPut(
    scope: string,
    key: string,
    requestHash: string,
    status: number,
    response: string,
    now = new Date(),
  ) {
    this.db
      .query(
        `insert into idempotency (scope, key, request_hash, status, response, created_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (scope, key) do update set request_hash = excluded.request_hash,
           status = excluded.status, response = excluded.response, created_at = excluded.created_at`,
      )
      .run(scope, key, requestHash, status, response, now.toISOString());
  }

  idempotencyPurge(notBefore: string) {
    this.db.query("delete from idempotency where created_at < ?").run(notBefore);
  }
}
