// Typed client for devmailbox's /api, sharing the server's message types.

import { useEffect, useRef, useState } from "react";
import type { CodeCandidate, LinkCandidate } from "../../server/extract.ts";
import type { Message, MessageSummary } from "../../server/message.ts";

export type { CodeCandidate, LinkCandidate, Message, MessageSummary };

export interface Mailbox {
  name: string;
  createdAt: string;
  messages: number;
  lastMessageAt: string | null;
}

export interface Page {
  data: MessageSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface Extracted {
  messageId: string;
  code: string | null;
  link: string | null;
  codes: CodeCandidate[];
  links: LinkCandidate[];
}

export interface Info {
  version: string;
  dashboard: string;
  api: string;
  openapi: string;
  mcp: string;
  providers: Record<string, Record<string, string>>;
  smtp: { host: string; port: number; auth: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "error",
      body?.error?.message ?? res.statusText,
    );
  }
  return (res.headers.get("content-type") ?? "").includes("json")
    ? ((await res.json()) as T)
    : ((await res.text()) as T);
}

const enc = encodeURIComponent;

export const api = {
  info: () => call<Info>("/api/info"),
  mailboxes: () => call<{ data: Mailbox[] }>("/api/mailboxes").then((r) => r.data),
  messages: (q: string, cursor?: string | null, limit = 50) =>
    call<Page>(
      `/api/messages?q=${enc(q)}&limit=${limit}${cursor ? `&cursor=${enc(cursor)}` : ""}`,
    ),
  message: (id: string) => call<Message>(`/api/messages/${enc(id)}`),
  extract: (id: string) => call<Extracted>(`/api/messages/${enc(id)}/extract`),
  raw: (id: string) => call<string>(`/api/messages/${enc(id)}/raw`),
  deleteMessage: (id: string) =>
    call<{ deleted: boolean }>(`/api/messages/${enc(id)}`, { method: "DELETE" }),
  deleteMailbox: (name: string) =>
    call<{ deleted: number }>(`/api/mailboxes/${enc(name)}`, { method: "DELETE" }),
  htmlUrl: (id: string, remote: boolean) =>
    `/api/messages/${enc(id)}/html${remote ? "?remote=1" : ""}`,
  rawUrl: (id: string) => `/api/messages/${enc(id)}/raw`,
  attachmentUrl: (id: string, attachmentId: string) =>
    `/api/messages/${enc(id)}/attachments/${enc(attachmentId)}`,
};

export type MailEvent =
  | { type: "message.created"; message: MessageSummary }
  | { type: "message.deleted"; id: string; mailbox: string }
  | { type: "mailbox.deleted"; mailbox: string };

export type Connection = "connecting" | "live" | "offline";

/** Live events for a query, reconnecting on its own. */
export function useMailEvents(q: string, onEvent: (e: MailEvent) => void): Connection {
  const [state, setState] = useState<Connection>("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const source = new EventSource(`/api/events?q=${enc(q)}`);
    setState("connecting");
    source.addEventListener("ready", () => setState("live"));
    source.addEventListener("error", () =>
      setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting"),
    );
    source.addEventListener("message.created", (e) =>
      handler.current({ type: "message.created", message: JSON.parse(e.data) }),
    );
    for (const type of ["message.deleted", "mailbox.deleted"] as const)
      source.addEventListener(type, (e) => handler.current(JSON.parse(e.data)));
    return () => source.close();
  }, [q]);
  return state;
}
