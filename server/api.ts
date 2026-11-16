// devmailbox's own API under /api: the unified inbox across every mailbox and way in. Routes are
// declared with zod schemas, served as OpenAPI at /api/openapi.json for typed clients.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { extractCodes, extractLinks } from "./extract.ts";
import { BadRequest, MAX_WAIT_MS, type Mail } from "./mail.ts";
import type { Message } from "./message.ts";
import { matches, parseQuery, QueryError, type Query } from "./query.ts";

export const VERSION = "0.1.1";

// ---------- schemas ----------

const ErrorBody = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .openapi("Error");

const Header = z.object({ name: z.string(), value: z.string() });

const Attachment = z
  .object({
    id: z.string(),
    filename: z.string().nullable(),
    contentType: z.string().nullable(),
    contentId: z.string().nullable(),
    disposition: z.enum(["attachment", "inline"]),
    size: z.number().int(),
    url: z
      .string()
      .nullable()
      .openapi({ description: "Set when the sender only gave a URL (never fetched)." }),
  })
  .openapi("Attachment");

const MessageSummary = z
  .object({
    id: z.string(),
    mailbox: z.string(),
    provider: z.string().openapi({ description: "How it arrived: a provider name or smtp." }),
    createdAt: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    subject: z.string(),
    snippet: z.string(),
    attachmentCount: z.number().int(),
    scheduledAt: z.string().nullable(),
  })
  .openapi("MessageSummary");

const MessageBody = MessageSummary.extend({
  bcc: z.array(z.string()),
  replyTo: z.array(z.string()),
  envelope: z
    .object({ from: z.string().nullable(), to: z.array(z.string()) })
    .nullable()
    .openapi({ description: "The SMTP envelope, for mail that arrived over SMTP." }),
  html: z.string().nullable(),
  text: z.string().nullable(),
  headers: z.array(Header),
  messageId: z.string().nullable(),
  attachments: z.array(Attachment),
  hasRaw: z.boolean().openapi({ description: "Whether /raw has the original source." }),
  size: z.number().int(),
  providerData: z
    .record(z.string(), z.unknown())
    .openapi({ description: "Provider-specific details (Resend: tags, template, last_event)." }),
}).openapi("Message");

const Mailbox = z
  .object({
    name: z.string(),
    createdAt: z.string(),
    messages: z.number().int(),
    lastMessageAt: z.string().nullable(),
  })
  .openapi("Mailbox");

const Code = z
  .object({
    value: z.string(),
    source: z.enum(["subject", "body", "template"]),
    context: z.string(),
    score: z.number(),
  })
  .openapi("Code");

const Link = z
  .object({
    url: z.string(),
    text: z.string().nullable(),
    kind: z.enum(["verification", "unsubscribe", "other"]),
    score: z.number(),
  })
  .openapi("Link");

const Extracted = z
  .object({
    messageId: z.string(),
    code: z.string().nullable().openapi({ description: "The best code candidate." }),
    link: z.string().nullable().openapi({ description: "The best verification link." }),
    codes: z.array(Code),
    links: z.array(Link),
  })
  .openapi("Extracted");

const QueryParam = z
  .string()
  .optional()
  .openapi({
    description:
      'Search: to:, from:, subject:, mailbox:, provider:, has:attachment, after:, before: and bare words. e.g. `to:dev@northwind.test subject:"confirm"`',
    example: "to:dev@northwind.test",
  });

const SinceParam = z.string().optional().openapi({
  description:
    "Only mail after this: an ISO time or a message id. Default: the last 30 seconds, so mail that arrived just before the wait still counts.",
});

const IdParam = z.object({ id: z.string() });

const errorResponses = {
  400: { description: "Bad request", content: { "application/json": { schema: ErrorBody } } },
  404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
} as const;

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

// ---------- helpers ----------

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 408,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);

function query(q: string | undefined): Query {
  try {
    return parseQuery(q);
  } catch (e) {
    if (e instanceof QueryError) throw new ApiError(400, "bad_query", e.message);
    throw e;
  }
}

export function extracted(m: Message) {
  const codes = extractCodes(m);
  const links = extractLinks(m);
  return {
    messageId: m.id,
    code: codes[0]?.value ?? null,
    link: links.find((l) => l.kind === "verification")?.url ?? null,
    codes,
    links,
  };
}

const SAFE_FILENAME = /[^\w.\- ]+/g;
const disposition = (kind: "attachment" | "inline", filename: string) =>
  `${kind}; filename="${filename.replace(SAFE_FILENAME, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

/** Email HTML runs with no scripts, no forms, no plugins and an opaque origin. */
export function htmlCsp(remoteImages: boolean) {
  return [
    "sandbox",
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' data:${remoteImages ? " https: http:" : ""}`,
    "font-src 'self' data:",
    "frame-ancestors 'self'",
  ].join("; ");
}

const DOWNLOAD_HEADERS = {
  "content-security-policy": "sandbox; default-src 'none'",
  "x-content-type-options": "nosniff",
};

// ---------- routes ----------

export function createApi(
  mail: Mail,
  info: (origin: string) => Record<string, unknown>,
) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          {
            error: {
              code: "bad_request",
              message: result.error.issues
                .map((i) => `${i.path.join(".") || "request"}: ${i.message}`)
                .join("; "),
            },
          },
          400,
        );
    },
  });
  const { store } = mail;

  app.onError((err, c) => {
    if (err instanceof ApiError)
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof BadRequest)
      return c.json({ error: { code: "bad_request", message: err.message } }, 400);
    console.error("devmailbox: api:", err);
    return c.json({ error: { code: "internal", message: err.message } }, 500);
  });

  const message = (id: string) => store.get(id) ?? (() => { throw notFound("message"); })();

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/health",
      tags: ["server"],
      responses: {
        200: json(z.object({ ok: z.boolean(), version: z.string() }), "Up"),
      },
    }),
    (c) => c.json({ ok: true, version: VERSION }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/info",
      tags: ["server"],
      description: "How to point senders and agents at this server.",
      responses: {
        200: json(z.record(z.string(), z.unknown()).openapi("Info"), "Server details"),
      },
    }),
    (c) => c.json(info(new URL(c.req.url).origin), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/mailboxes",
      tags: ["mailboxes"],
      responses: { 200: json(z.object({ data: z.array(Mailbox) }), "Every mailbox") },
    }),
    (c) => c.json({ data: store.mailboxes() }, 200),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/mailboxes/{name}",
      tags: ["mailboxes"],
      description: "Delete a mailbox and all its messages. It comes back when mail arrives.",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: json(z.object({ deleted: z.number().int() }), "Messages deleted"),
        ...errorResponses,
      },
    }),
    (c) => {
      const n = mail.deleteMailbox(c.req.valid("param").name);
      if (n === null) throw notFound("mailbox");
      return c.json({ deleted: n }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages",
      tags: ["messages"],
      description: "Search every mailbox, newest first.",
      request: {
        query: z.object({
          q: QueryParam,
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z
            .string()
            .optional()
            .openapi({ description: "nextCursor from the previous page" }),
        }),
      },
      responses: {
        200: json(
          z.object({
            data: z.array(MessageSummary),
            hasMore: z.boolean(),
            nextCursor: z.string().nullable(),
          }),
          "A page of messages",
        ),
        ...errorResponses,
      },
    }),
    (c) => {
      const { q, limit, cursor } = c.req.valid("query");
      const page = store.search(query(q), { limit, cursor });
      return c.json(
        {
          data: page.data,
          hasMore: page.hasMore,
          nextCursor: page.hasMore ? page.data.at(-1)!.id : null,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages/{id}",
      tags: ["messages"],
      request: { params: IdParam },
      responses: { 200: json(MessageBody, "The message"), ...errorResponses },
    }),
    (c) => c.json(message(c.req.valid("param").id), 200),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/messages/{id}",
      tags: ["messages"],
      request: { params: IdParam },
      responses: { 200: json(z.object({ deleted: z.boolean() }), "Deleted"), ...errorResponses },
    }),
    (c) => {
      if (!mail.deleteMessage(c.req.valid("param").id)) throw notFound("message");
      return c.json({ deleted: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages/{id}/html",
      tags: ["messages"],
      description:
        "The HTML body, sandboxed by CSP: no scripts, forms or remote content, and an opaque origin. cid: images point at the message's attachments. Remote images load only with ?remote=1. Frame it with <iframe sandbox>.",
      request: {
        params: IdParam,
        query: z.object({ remote: z.enum(["0", "1"]).default("0") }),
      },
      responses: {
        200: { description: "HTML", content: { "text/html": { schema: z.string() } } },
        ...errorResponses,
      },
    }),
    (c) => {
      const { id } = c.req.valid("param");
      const m = message(id);
      if (m.html === null) throw notFound("HTML body");
      const cids = store.contentIds(id);
      const html = m.html.replace(/\bcid:([^"'\s)>]+)/gi, (all, cid: string) => {
        const aid = cids.get(decodeURIComponent(cid));
        return aid ? `/api/messages/${id}/attachments/${aid}` : all;
      });
      return c.body(html, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": htmlCsp(c.req.valid("query").remote === "1"),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages/{id}/raw",
      tags: ["messages"],
      description: "The original source (.eml), for mail that arrived over SMTP.",
      request: { params: IdParam },
      responses: {
        200: {
          description: "Source",
          content: { "message/rfc822": { schema: z.string().openapi({ format: "binary" }) } },
        },
        ...errorResponses,
      },
    }),
    (c) => {
      const { id } = c.req.valid("param");
      const raw = store.raw(id);
      if (!raw) throw notFound(store.seqOf(id) === null ? "message" : "raw source");
      return c.body(new Uint8Array(raw), 200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": disposition("attachment", `${id}.eml`),
        ...DOWNLOAD_HEADERS,
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages/{id}/attachments/{attachmentId}",
      tags: ["messages"],
      description: "Always served as a download, so attached HTML can't run on this origin.",
      request: { params: z.object({ id: z.string(), attachmentId: z.string() }) },
      responses: {
        200: {
          description: "The file",
          content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
        },
        ...errorResponses,
      },
    }),
    (c) => {
      const { id, attachmentId } = c.req.valid("param");
      const a = store.attachment(id, attachmentId);
      if (!a) throw notFound("attachment");
      if (!a.content)
        throw new ApiError(
          404,
          "not_stored",
          `the sender only gave a URL, which devmailbox doesn't fetch: ${a.info.url}`,
        );
      return c.body(new Uint8Array(a.content), 200, {
        "content-type": a.info.contentType ?? "application/octet-stream",
        "content-disposition": disposition("attachment", a.info.filename ?? attachmentId),
        ...DOWNLOAD_HEADERS,
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/messages/{id}/extract",
      tags: ["messages"],
      description: "One-time codes and links found in the message, best first.",
      request: { params: IdParam },
      responses: { 200: json(Extracted, "Codes and links"), ...errorResponses },
    }),
    (c) => c.json(extracted(message(c.req.valid("param").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/wait",
      tags: ["messages"],
      description:
        "Long-poll for the newest message matching q that arrived after `since`. Returns at once if one already has; 408 if none arrives within `timeout`.",
      request: {
        query: z.object({
          q: QueryParam,
          since: SinceParam,
          timeout: z.coerce
            .number()
            .int()
            .min(0)
            .max(MAX_WAIT_MS)
            .default(30_000)
            .openapi({ description: `Milliseconds, up to ${MAX_WAIT_MS}` }),
        }),
      },
      responses: {
        200: json(MessageBody, "The message"),
        408: json(ErrorBody, "Nothing arrived in time"),
        400: errorResponses[400],
      },
    }),
    async (c) => {
      const { q, since, timeout } = c.req.valid("query");
      const m = await mail.waitFor(query(q), mail.resolveSince(since), timeout, c.req.raw.signal);
      if (!m)
        throw new ApiError(408, "timeout", `no message matching "${q ?? ""}" within ${timeout}ms`);
      return c.json(m, 200);
    },
  );

  // SSE isn't expressible as an OpenAPI route; documented below.
  app.get("/api/events", (c: Context) => {
    const q = query(c.req.query("q"));
    return streamSSE(c, async (stream) => {
      const queue: Array<{ event: string; data: string }> = [];
      let wake = () => {};
      const unsubscribe = mail.subscribe((e) => {
        if (e.type === "message.created") {
          if (!matches(q, e.searchable)) return;
          queue.push({ event: e.type, data: JSON.stringify(e.message) });
        } else queue.push({ event: e.type, data: JSON.stringify(e) });
        wake();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake();
      });
      await stream.writeSSE({ event: "ready", data: "{}" });
      while (!stream.aborted) {
        const next = queue.shift();
        if (next) {
          await stream.writeSSE(next);
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, 15_000);
        });
        clearTimeout(timer);
        if (!queue.length && !stream.aborted) await stream.write(": heartbeat\n\n");
      }
      unsubscribe();
    });
  });

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "devmailbox",
      version: VERSION,
      description:
        "The unified inbox. Live updates: GET /api/events?q=… is a Server-Sent Events stream of message.created (a MessageSummary, filtered by q), message.deleted and mailbox.deleted.",
    },
  });

  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: "no such endpoint" } }, 404),
  );

  return app;
}
