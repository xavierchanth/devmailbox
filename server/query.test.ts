import { describe, expect, test } from "bun:test";
import { DEFAULTS } from "./config.ts";
import { Mail } from "./mail.ts";
import type { NewMessage } from "./message.ts";
import { matches, parseQuery, QueryError, formatQuery } from "./query.ts";
import { searchable, Store } from "./store.ts";

const base: NewMessage = {
  mailbox: "default",
  provider: "resend",
  from: "Align <auth@align.test>",
  to: ["dev@align.test"],
  cc: [],
  bcc: [],
  replyTo: [],
  envelope: null,
  subject: "Your Align code",
  html: null,
  text: "Your code is 123456",
  headers: [],
  messageId: null,
  scheduledAt: null,
  attachments: [],
  raw: null,
  providerData: {},
};

const MESSAGES: Record<string, Partial<NewMessage>> = {
  otp: {},
  invite: {
    mailbox: "slot3",
    from: "Supabase Auth <noreply@mail.app.supabase.io>",
    to: ["Seed One <seed01@align.test>"],
    cc: ["Ops@Align.test"],
    subject: "You have been invited",
    text: null,
    html: "<p>Follow this <b>magic</b> link to accept</p>",
  },
  smtpBcc: {
    mailbox: "slot3",
    provider: "smtp",
    from: "x@y.test",
    to: ["list@align.test"],
    envelope: { from: "bounce@y.test", to: ["hidden@align.test"] },
    subject: "Weekly digest",
    text: "Nothing to see",
    attachments: [
      { filename: "a.txt", contentType: "text/plain", contentId: null, disposition: "attachment", content: new Uint8Array([1]), url: null },
    ],
  },
  unicode: { subject: "Ünïcode Ünterschrift", to: ["ÄRGER@align.test"], text: "straße" },
};

// [query, names of the messages it should match]
const CASES: Array<[string, string[]]> = [
  ["", ["otp", "invite", "smtpBcc", "unicode"]],
  ["to:dev@align.test", ["otp"]],
  ["to:one@align.test", []], // a complete address is exact: not seed01's "Seed One <…>" name
  ["to:seed01@align.test", ["invite"]], // found inside "Name <address>"
  ["to:ev@align.test", []], // never a suffix of dev@align.test
  ["to:seed01@align", ["invite"]], // fragments (no dotted domain) are substrings
  ["to:ev@", ["otp"]],
  ["to:@align.test", ["otp", "invite", "smtpBcc", "unicode"]],
  ["to:DEV@ALIGN.TEST", ["otp"]],
  ["to:ops@align", ["invite"]], // cc counts as a recipient
  ["to:hidden", ["smtpBcc"]], // the SMTP envelope too
  ["to:seed01 to:dev", ["otp", "invite"]], // same key twice: OR
  ["from:supabase", ["invite"]],
  ["from:bounce@y.test", ["smtpBcc"]], // envelope sender
  ["from:align to:dev", ["otp"]], // different keys: AND
  ['subject:"been invited"', ["invite"]],
  ["mailbox:slot3", ["invite", "smtpBcc"]],
  ["mailbox:SLOT3", ["invite", "smtpBcc"]],
  ["mailbox:slot", []], // mailbox is exact
  ["provider:smtp", ["smtpBcc"]],
  ["has:attachment", ["smtpBcc"]],
  ["magic", ["invite"]], // bare words search the HTML-derived body
  ["123456", ["otp"]],
  ["code 123", ["otp"]], // bare words AND
  ["code digest", []],
  ["Seed One", ["invite"]], // display names are searchable
  // case folding beyond ASCII, the same in SQL and memory
  ["subject:ünïcode", ["unicode"]],
  ["subject:ÜNÏCODE", ["unicode"]],
  ["to:ärger", ["unicode"]],
  ["straße", ["unicode"]],
  ["unknown:thing", []], // unknown keys are plain words
];

describe("query", () => {
  const store = new Store(":memory:");
  const ids = new Map<string, string>();
  const live = new Map<string, ReturnType<typeof searchable>>();
  for (const [name, over] of Object.entries(MESSAGES)) {
    const { message, searchable: s } = store.insert({ ...base, ...over });
    ids.set(message.id, name);
    live.set(name, s);
  }

  for (const [q, expected] of CASES)
    test(`"${q}" → ${expected.join(", ") || "nothing"}`, () => {
      const parsed = parseQuery(q);
      const fromSql = store
        .search(parsed, { limit: 100 })
        .data.map((m) => ids.get(m.id)!)
        .sort();
      const inMemory = [...live]
        .filter(([, s]) => matches(parsed, s))
        .map(([n]) => n)
        .sort();
      expect(fromSql).toEqual([...expected].sort());
      expect(inMemory).toEqual(fromSql);
    });

  test("after/before compare times", () => {
    const s = { ...live.get("otp")!, createdAt: "2026-11-12T10:00:00.000Z" };
    expect(matches(parseQuery("after:2026-11-12T09:00:00Z"), s)).toBe(true);
    expect(matches(parseQuery("after:2026-11-12T11:00:00Z"), s)).toBe(false);
    expect(matches(parseQuery("before:2026-11-13"), s)).toBe(true);
  });

  test("bad values are errors", () => {
    expect(() => parseQuery("after:soon")).toThrow(QueryError);
    expect(() => parseQuery("has:html")).toThrow(QueryError);
  });

  test("formatQuery round-trips", () => {
    const q = parseQuery('to:dev from:"Align Auth" has:attachment word');
    expect(parseQuery(formatQuery(q))).toEqual(q);
  });
});

describe("retention", () => {
  test("keeps the newest messages per mailbox and drops old ones", () => {
    const cfg = { ...DEFAULTS, dataDir: ":memory:", retention: { maxMessagesPerMailbox: 2, maxAgeHours: 1 } };
    const store = new Store(":memory:");
    const mail = new Mail(cfg, store);
    const deleted: string[] = [];
    mail.subscribe((e) => e.type === "message.deleted" && deleted.push(e.id));
    const old = store.insert({ ...base, subject: "old" }, new Date(Date.now() - 2 * 3_600_000)).message;
    const a = mail.ingest({ ...base, subject: "a" });
    const b = mail.ingest({ ...base, subject: "b" });
    const other = mail.ingest({ ...base, mailbox: "other", subject: "c" });
    mail.ingest({ ...base, subject: "d" });
    expect(deleted).toContain(old.id);
    expect(deleted).toContain(a.id);
    expect(store.get(b.id)).not.toBeNull();
    expect(store.get(other.id)).not.toBeNull();
  });
});
