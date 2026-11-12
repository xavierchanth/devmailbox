// The mail service: every way in calls ingest(), every way out reads through here. It owns the
// store, live events (SSE, waiters) and retention, and hands each provider a narrow scope.

import type { Config } from "./config.ts";
import type { Message, MessageSummary, NewMessage } from "./message.ts";
import { matches, type Query, type Searchable } from "./query.ts";
import type { Page, Store } from "./store.ts";

export type MailEvent =
  | { type: "message.created"; message: MessageSummary; searchable: Searchable }
  | { type: "message.deleted"; id: string; mailbox: string }
  | { type: "mailbox.deleted"; mailbox: string };

export class BadRequest extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How far back `wait` looks by default, so mail that beat the waiter still counts. */
export const DEFAULT_LOOKBACK_MS = 30_000;
export const MAX_WAIT_MS = 120_000;

export type Since = { seq?: number; time?: string };

export class Mail {
  private listeners = new Set<(e: MailEvent) => void>();

  constructor(
    readonly cfg: Config,
    readonly store: Store,
  ) {}

  subscribe(fn: (e: MailEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: MailEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error("devmailbox: event listener failed:", err);
      }
    }
  }

  ingest(m: NewMessage): Message {
    const { message, searchable } = this.store.insert(m);
    this.emit({ type: "message.created", message, searchable });
    this.applyRetention(m.mailbox);
    return message;
  }

  applyRetention(mailbox?: string) {
    for (const d of this.store.sweep(this.cfg.retention, new Date(), mailbox))
      this.emit({ type: "message.deleted", ...d });
    this.store.idempotencyPurge(
      new Date(Date.now() - 24 * 3_600_000).toISOString(),
    );
  }

  deleteMessage(id: string): boolean {
    const m = this.store.deleteMessage(id);
    if (m) this.emit({ type: "message.deleted", id, mailbox: m.mailbox });
    return !!m;
  }

  deleteMailbox(name: string): number | null {
    const ids = this.store.deleteMailbox(name);
    if (!ids) return null;
    this.emit({ type: "mailbox.deleted", mailbox: name });
    return ids.length;
  }

  /** `since`: an ISO time or a message id. Default: DEFAULT_LOOKBACK_MS ago. */
  resolveSince(since: string | null | undefined, now = Date.now()): Since {
    if (!since)
      return { time: new Date(now - DEFAULT_LOOKBACK_MS).toISOString() };
    if (UUID.test(since)) {
      const seq = this.store.seqOf(since);
      if (seq === null) throw new BadRequest(`since: no message ${since}`);
      return { seq };
    }
    const t = Date.parse(since);
    if (Number.isNaN(t))
      throw new BadRequest(`since: needs an ISO time or a message id`);
    return { time: new Date(t).toISOString() };
  }

  /**
   * The newest message matching `q` that arrived after `since`, waiting up to `timeoutMs` for one.
   * Resolves null on timeout or abort.
   */
  async waitFor(
    q: Query,
    since: Since,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Message | null> {
    const ms = Math.max(0, Math.min(timeoutMs, MAX_WAIT_MS));
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    // subscribe before looking, so nothing lands between the look and the wait
    const arrived = new Promise<string | null>((resolve) => {
      unsubscribe = this.subscribe((e) => {
        if (
          e.type === "message.created" &&
          matches(q, e.searchable) &&
          (!since.time || e.searchable.createdAt > since.time)
        )
          resolve(e.message.id);
      });
      timer = setTimeout(() => resolve(null), ms);
      onAbort = () => resolve(null);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const existing = this.store.newestMatch(q, since);
      if (existing) return existing;
      if (ms === 0 || signal?.aborted) return null;
      const id = await arrived;
      return id ? this.store.get(id) : null;
    } finally {
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  forProvider(name: string): ProviderScope {
    return new ProviderScope(name, this);
  }
}

export type IdempotencyStart =
  | { kind: "new"; finish: (status: number, body: unknown) => void; abort: () => void }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "mismatch" }
  | { kind: "in-flight" };

/**
 * What a provider may do: store its own messages and read them back, keep its own data on them,
 * and keep idempotency records. It never sees /api, other providers or the database.
 */
export class ProviderScope {
  private inFlight = new Set<string>();

  constructor(
    readonly name: string,
    private mail: Mail,
  ) {}

  ingest(m: Omit<NewMessage, "provider">): Message {
    return this.mail.ingest({ ...m, provider: this.name });
  }

  get(mailbox: string, id: string): Message | null {
    return this.mail.store.providerGet(this.name, mailbox, id);
  }

  list(
    mailbox: string,
    opts: { limit: number; after?: string; before?: string },
  ): Page<Message> | null {
    return this.mail.store.providerList(this.name, mailbox, opts);
  }

  update(
    id: string,
    data: Record<string, unknown>,
    scheduledAt?: string | null,
  ) {
    this.mail.store.setProviderData(id, data, scheduledAt);
  }

  /** Where /api serves an attachment, for providers that hand out download URLs. */
  attachmentPath(messageId: string, attachmentId: string): string {
    return `/api/messages/${messageId}/attachments/${attachmentId}`;
  }

  /**
   * Start an idempotent request. `scope` separates accounts and endpoints; `requestHash`
   * identifies the body. Records last 24 hours.
   */
  idempotency(scope: string, key: string, requestHash: string): IdempotencyStart {
    const full = `${this.name}:${scope}`;
    const flightKey = `${full}\n${key}`;
    if (this.inFlight.has(flightKey)) return { kind: "in-flight" };
    const store = this.mail.store;
    const prior = store.idempotencyGet(
      full,
      key,
      new Date(Date.now() - 24 * 3_600_000).toISOString(),
    );
    if (prior)
      return prior.requestHash === requestHash
        ? { kind: "replay", status: prior.status, body: JSON.parse(prior.response) }
        : { kind: "mismatch" };
    this.inFlight.add(flightKey);
    return {
      kind: "new",
      finish: (status, body) => {
        store.idempotencyPut(full, key, requestHash, status, JSON.stringify(body));
        this.inFlight.delete(flightKey);
      },
      abort: () => this.inFlight.delete(flightKey),
    };
  }
}
