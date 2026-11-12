// The search language shared by the dashboard, /api and MCP:
//
//   to:dev@northwind.test from:supabase subject:"confirm" mailbox:slot3 has:attachment magic link
//
// to/from/subject and bare words match substrings, ignoring case, except that a complete address
// (to:dev@northwind.test) matches only that address, never other-dev@northwind.test. Repeating a key ORs its
// values; different keys and bare words AND. A query runs in two places that must agree: as SQL
// over stored mail (toSql) and in memory against a message that just arrived (matches), which
// wakes waiters and filters live events. Both read the same Searchable fields.

export interface Query {
  from: string[];
  to: string[];
  subject: string[];
  mailbox: string[];
  provider: string[];
  hasAttachment: boolean;
  after: string | null;
  before: string | null;
  text: string[];
}

/** The flattened fields a query looks at, stored as columns and rebuilt for live messages. */
export interface Searchable {
  mailbox: string;
  provider: string;
  /** The From header and the SMTP envelope sender. */
  from: string;
  /** To, Cc, Bcc and the SMTP envelope recipients, one per line. */
  recipients: string;
  /** Bare addresses of `from`, each wrapped in newlines: "\na@b.test\n". */
  fromAddresses: string;
  /** Bare addresses of `recipients`, the same way. */
  recipientAddresses: string;
  subject: string;
  /** Plain text body (generated from the HTML when there's no text part). */
  body: string;
  attachments: number;
  /** ISO 8601, UTC. */
  createdAt: string;
}

export class QueryError extends Error {}

const KEYS = new Set([
  "from",
  "to",
  "subject",
  "mailbox",
  "provider",
  "has",
  "after",
  "before",
]);

/**
 * Case folding for search. The store keeps search columns folded with this same function, so
 * SQL compares folded text with folded terms and never needs SQLite's ASCII-only lower().
 */
export const fold = (s: string) => s.toLowerCase();

function isoTime(v: string, key: string): string {
  const t = Date.parse(v);
  if (Number.isNaN(t))
    throw new QueryError(`${key}: needs a date or time, got "${v}"`);
  return new Date(t).toISOString();
}

/** user@host.tld: anything shorter is a fragment, matched as a substring. */
const COMPLETE_ADDRESS = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

/** The bare addresses in a list of "Name <a@b>" or "a@b" entries, newline-wrapped for exact lookup. */
export function addressIndex(entries: string[]): string {
  const bare = entries
    .map((e) => (/<([^<>]+)>\s*$/.exec(e)?.[1] ?? e).trim())
    .filter(Boolean);
  return bare.length ? `\n${bare.join("\n")}\n` : "";
}

export function emptyQuery(): Query {
  return {
    from: [],
    to: [],
    subject: [],
    mailbox: [],
    provider: [],
    hasAttachment: false,
    after: null,
    before: null,
    text: [],
  };
}

export function parseQuery(input: string | null | undefined): Query {
  const q = emptyQuery();
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;
  for (const m of (input ?? "").matchAll(re)) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const value = m[2] ?? m[4];
    if (key && value !== undefined && KEYS.has(key)) {
      if (!value) continue;
      switch (key) {
        case "has":
          if (!/^attachments?$/i.test(value))
            throw new QueryError(`has: only supports has:attachment`);
          q.hasAttachment = true;
          break;
        case "after":
          q.after = isoTime(value, key);
          break;
        case "before":
          q.before = isoTime(value, key);
          break;
        default:
          (q[key as "from" | "to" | "subject" | "mailbox" | "provider"]).push(
            value,
          );
      }
      continue;
    }
    const word = m[5] ?? m[6] ?? m[0];
    if (word) q.text.push(word);
  }
  return q;
}

export function formatQuery(q: Query): string {
  const v = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);
  return [
    ...q.mailbox.map((s) => `mailbox:${v(s)}`),
    ...q.provider.map((s) => `provider:${v(s)}`),
    ...q.from.map((s) => `from:${v(s)}`),
    ...q.to.map((s) => `to:${v(s)}`),
    ...q.subject.map((s) => `subject:${v(s)}`),
    ...(q.hasAttachment ? ["has:attachment"] : []),
    ...(q.after ? [`after:${q.after}`] : []),
    ...(q.before ? [`before:${q.before}`] : []),
    ...q.text.map(v),
  ].join(" ");
}

const has = (field: string, term: string) => fold(field).includes(fold(term));
/** to:/from: — exact for a complete address, substring otherwise. */
const address = (display: string, index: string, term: string) =>
  COMPLETE_ADDRESS.test(term)
    ? fold(index).includes(`\n${fold(term)}\n`)
    : has(display, term);
const same = (field: string, term: string) => fold(field) === fold(term);

export function matches(q: Query, m: Searchable): boolean {
  const any = (terms: string[], test: (t: string) => boolean) =>
    !terms.length || terms.some(test);
  return (
    any(q.mailbox, (t) => same(m.mailbox, t)) &&
    any(q.provider, (t) => same(m.provider, t)) &&
    any(q.from, (t) => address(m.from, m.fromAddresses, t)) &&
    any(q.to, (t) => address(m.recipients, m.recipientAddresses, t)) &&
    any(q.subject, (t) => has(m.subject, t)) &&
    (!q.hasAttachment || m.attachments > 0) &&
    (!q.after || m.createdAt > q.after) &&
    (!q.before || m.createdAt < q.before) &&
    q.text.every(
      (t) =>
        has(m.subject, t) ||
        has(m.from, t) ||
        has(m.recipients, t) ||
        has(m.body, t),
    )
  );
}

/** Column names for each Searchable field in the messages table. Text columns hold fold()ed text. */
export const COLUMNS: Record<keyof Searchable, string> = {
  mailbox: "search_mailbox",
  provider: "search_provider",
  from: "search_from",
  recipients: "search_to",
  fromAddresses: "search_from_addrs",
  recipientAddresses: "search_to_addrs",
  subject: "search_subject",
  body: "search_body",
  attachments: "attachment_count",
  createdAt: "created_at",
};

export function toSql(q: Query): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  const contains = (col: string, t: string) => {
    params.push(fold(t));
    return `instr(${col}, ?) > 0`;
  };
  const equals = (col: string, t: string) => {
    params.push(fold(t));
    return `${col} = ?`;
  };
  const anyOf = (terms: string[], one: (t: string) => string) => {
    if (terms.length) clauses.push(`(${terms.map(one).join(" OR ")})`);
  };
  anyOf(q.mailbox, (t) => equals(COLUMNS.mailbox, t));
  anyOf(q.provider, (t) => equals(COLUMNS.provider, t));
  const address = (display: string, index: string) => (t: string) =>
    COMPLETE_ADDRESS.test(t) ? contains(index, `\n${t}\n`) : contains(display, t);
  anyOf(q.from, address(COLUMNS.from, COLUMNS.fromAddresses));
  anyOf(q.to, address(COLUMNS.recipients, COLUMNS.recipientAddresses));
  anyOf(q.subject, (t) => contains(COLUMNS.subject, t));
  if (q.hasAttachment) clauses.push(`${COLUMNS.attachments} > 0`);
  if (q.after) {
    params.push(q.after);
    clauses.push(`${COLUMNS.createdAt} > ?`);
  }
  if (q.before) {
    params.push(q.before);
    clauses.push(`${COLUMNS.createdAt} < ?`);
  }
  for (const t of q.text)
    clauses.push(
      `(${[COLUMNS.subject, COLUMNS.from, COLUMNS.recipients, COLUMNS.body]
        .map((c) => contains(c, t))
        .join(" OR ")})`,
    );
  return { where: clauses.length ? clauses.join(" AND ") : "1", params };
}
