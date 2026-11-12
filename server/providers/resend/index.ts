// Resend's email API (https://resend.com/docs/api-reference), mounted at /resend:
//   RESEND_BASE_URL=http://localhost:7430/resend
// Any API key is accepted, or none; the key only picks the mailbox (re_slot3 → slot3). Reads
// see this provider's messages in that key's mailbox, the way a Resend account would.

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ProviderScope } from "../../mail.ts";
import { mailboxFromCredential, type Message } from "../../message.ts";
import type { Provider } from "../index.ts";
import { validateEmail, parseSchedule, type ResendError } from "./validate.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 100;

export function errorResponse(e: ResendError): Response {
  return new Response(
    JSON.stringify({ statusCode: e.status, message: e.message, name: e.name }),
    {
      status: e.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (status: ResendError["status"], name: string, message: string) =>
  errorResponse({ status, name, message });

/** Postgres timestamp text, as Resend returns: 2026-04-03 22:13:42.674000+00 */
export function pgTime(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(iso);
  if (!m) return iso;
  return `${m[1]} ${m[2]}.${(m[3] ?? "").padEnd(6, "0").slice(0, 6)}+00`;
}

const mailboxOf = (c: Context) => {
  const auth = c.req.header("authorization") ?? "";
  return mailboxFromCredential(auth.replace(/^Bearer\s+/i, ""), "re_");
};

/** Stable JSON for comparing idempotent request bodies. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

const hash = (v: unknown) =>
  new Bun.CryptoHasher("sha256").update(canonical(v)).digest("hex");

type Data = {
  lastEvent?: string;
  tags?: Array<{ name: string; value: string }> | null;
  topicId?: string | null;
};

function emailObject(m: Message) {
  const d = m.providerData as Data;
  return {
    object: "email",
    id: m.id,
    message_id: m.messageId,
    to: m.to,
    from: m.from,
    created_at: pgTime(m.createdAt),
    subject: m.subject,
    html: m.html,
    text: m.text,
    bcc: m.bcc,
    cc: m.cc,
    reply_to: m.replyTo,
    last_event: d.lastEvent ?? "delivered",
    scheduled_at: pgTime(m.scheduledAt),
    tags: d.tags ?? [],
    ...(d.topicId ? { topic_id: d.topicId } : {}),
  };
}

function listItem(m: Message) {
  const d = m.providerData as Data;
  const orNull = (a: string[]) => (a.length ? a : null);
  return {
    id: m.id,
    message_id: m.messageId,
    to: m.to,
    from: m.from,
    created_at: pgTime(m.createdAt),
    subject: m.subject,
    bcc: orNull(m.bcc),
    cc: orNull(m.cc),
    reply_to: orNull(m.replyTo),
    last_event: d.lastEvent ?? "delivered",
    scheduled_at: pgTime(m.scheduledAt),
  };
}

export function createResend(scope: ProviderScope): Provider {
  const app = new Hono();

  app.onError((err) => {
    console.error("devmailbox: resend:", err);
    return fail(500, "application_error", "An unexpected error occurred.");
  });

  // Attachments may be up to 40MB after base64; leave room for the rest of the body.
  app.use(
    "*",
    bodyLimit({
      maxSize: 50 * 1024 * 1024,
      onError: () =>
        fail(422, "validation_error", "The request body is too large."),
    }),
  );

  async function readJson(c: Context): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return {
        ok: false,
        res: fail(422, "validation_error", "The request body must be valid JSON."),
      };
    }
  }

  /** Runs `send` once per Idempotency-Key (24h), replaying its response for the same body. */
  async function idempotent(
    c: Context,
    endpoint: string,
    body: unknown,
    send: () => { status: number; body: unknown } | Response,
  ): Promise<Response> {
    const key = c.req.header("idempotency-key");
    if (key === undefined) {
      const r = send();
      return r instanceof Response ? r : ok(r.body, r.status);
    }
    if (key.length < 1 || key.length > 256)
      return fail(
        400,
        "invalid_idempotency_key",
        "Idempotency keys, if present, must have between 1 and 256 characters.",
      );
    const start = scope.idempotency(`${mailboxOf(c)}:POST ${endpoint}`, key, hash(body));
    switch (start.kind) {
      case "replay":
        return ok(start.body, start.status);
      case "mismatch":
        return fail(
          409,
          "invalid_idempotent_request",
          "This idempotency key has been used with this HTTP method and endpoint within the last 24 hours, but the request body was modified and doesn't match the original request.",
        );
      case "in-flight":
        return fail(
          409,
          "concurrent_idempotent_requests",
          "There is another request in progress with the same idempotency key.",
        );
    }
    try {
      const r = send();
      // only successful sends are remembered; a corrected retry may reuse the key
      if (r instanceof Response) {
        start.abort();
        return r;
      }
      start.finish(r.status, r.body);
      return ok(r.body, r.status);
    } catch (e) {
      start.abort();
      throw e;
    }
  }

  app.post("/emails", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return parsed.res;
    const mailbox = mailboxOf(c);
    return idempotent(c, "/emails", parsed.body, () => {
      const v = validateEmail(parsed.body, { batch: false });
      if (!v.ok) return errorResponse(v.error);
      const m = scope.ingest({ ...v.message, mailbox });
      return { status: 200, body: { id: m.id } };
    });
  });

  app.post("/emails/batch", async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return parsed.res;
    const mailbox = mailboxOf(c);
    const permissive =
      (c.req.header("x-batch-validation") ?? "strict").toLowerCase() === "permissive";
    return idempotent(c, "/emails/batch", parsed.body, () => {
      const list = parsed.body;
      if (!Array.isArray(list))
        return fail(422, "validation_error", "The request body must be an array of emails.");
      if (!list.length)
        return fail(422, "validation_error", "The batch must contain at least one email.");
      if (list.length > MAX_BATCH)
        return fail(
          422,
          "validation_error",
          `Too many emails. A batch can contain at most ${MAX_BATCH} emails.`,
        );
      const results = list.map((e) => validateEmail(e, { batch: true }));
      const errors = results.flatMap((r, index) =>
        r.ok ? [] : [{ index, message: r.error.message }],
      );
      if (!permissive) {
        const first = results.find((r) => !r.ok);
        if (first && !first.ok) return errorResponse(first.error);
      }
      const data = results.flatMap((r) =>
        r.ok ? [{ id: scope.ingest({ ...r.message, mailbox }).id }] : [],
      );
      return { status: 200, body: permissive ? { data, errors } : { data } };
    });
  });

  app.get("/emails", (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return fail(422, "validation_error", "The `limit` parameter must be an integer between 1 and 100.");
    const after = c.req.query("after");
    const before = c.req.query("before");
    if (after && before)
      return fail(422, "validation_error", "You can only use either `after` or `before`, not both.");
    const page = scope.list(mailboxOf(c), { limit, after, before }) ?? {
      data: [],
      hasMore: false,
    };
    return ok({ object: "list", has_more: page.hasMore, data: page.data.map(listItem) });
  });

  const findEmail = (c: Context): Message | Response => {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id))
      return fail(422, "invalid_parameter", "The `id` must be a valid UUID.");
    return (
      scope.get(mailboxOf(c), id) ?? fail(404, "not_found", "Email not found")
    );
  };

  app.get("/emails/:id", (c) => {
    const m = findEmail(c);
    return m instanceof Response ? m : ok(emailObject(m));
  });

  app.patch("/emails/:id", async (c) => {
    const m = findEmail(c);
    if (m instanceof Response) return m;
    const parsed = await readJson(c);
    if (!parsed.ok) return parsed.res;
    const at = (parsed.body as { scheduled_at?: unknown } | null)?.scheduled_at;
    if (typeof at !== "string") return fail(422, "missing_required_field", "Missing `scheduled_at` field.");
    const iso = parseSchedule(at);
    if (!iso)
      return fail(422, "validation_error", "Invalid `scheduled_at` field. Use an ISO 8601 date or natural language such as `in 1 min`.");
    const d = m.providerData as Data;
    if (d.lastEvent !== "scheduled")
      return fail(422, "validation_error", "Only scheduled emails can be updated.");
    scope.update(m.id, { ...m.providerData }, iso);
    return ok({ object: "email", id: m.id });
  });

  app.post("/emails/:id/cancel", (c) => {
    const m = findEmail(c);
    if (m instanceof Response) return m;
    if ((m.providerData as Data).lastEvent !== "scheduled")
      return fail(422, "validation_error", "Only scheduled emails can be canceled.");
    scope.update(m.id, { ...m.providerData, lastEvent: "canceled" });
    return ok({ object: "email", id: m.id });
  });

  const attachmentObject = (c: Context, m: Message, a: Message["attachments"][number]) => ({
    id: a.id,
    filename: a.filename,
    size: a.size,
    content_type: a.contentType,
    content_disposition: a.disposition,
    content_id: a.contentId,
    download_url: a.url ?? new URL(scope.attachmentPath(m.id, a.id), c.req.url).toString(),
    expires_at: pgTime(new Date(Date.now() + 3_600_000).toISOString()),
  });

  app.get("/emails/:id/attachments", (c) => {
    const m = findEmail(c);
    if (m instanceof Response) return m;
    return ok({
      object: "list",
      has_more: false,
      data: m.attachments.map((a) => attachmentObject(c, m, a)),
    });
  });

  app.get("/emails/:id/attachments/:attachmentId", (c) => {
    const m = findEmail(c);
    if (m instanceof Response) return m;
    const a = m.attachments.find((x) => x.id === c.req.param("attachmentId"));
    if (!a) return fail(404, "not_found", "Attachment not found");
    return ok({ object: "attachment", ...attachmentObject(c, m, a) });
  });

  // Known paths with the wrong method, then everything else.
  for (const path of [
    "/emails",
    "/emails/batch",
    "/emails/:id",
    "/emails/:id/cancel",
    "/emails/:id/attachments",
    "/emails/:id/attachments/:attachmentId",
  ])
    app.all(path, () =>
      fail(405, "method_not_allowed", "Method is not allowed for the requested path."),
    );
  app.all("*", () =>
    fail(404, "not_found", "The requested endpoint does not exist."),
  );

  return {
    name: scope.name,
    app,
    reject: (status, message) =>
      fail(status, status === 403 ? "validation_error" : "not_found", message),
    describe: (baseUrl) => ({
      RESEND_BASE_URL: `${baseUrl}/${scope.name}`,
      RESEND_API_KEY: "re_<mailbox> (any value; it only picks the mailbox)",
    }),
  };
}
