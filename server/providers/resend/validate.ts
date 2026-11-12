// Request validation for Resend's send endpoints, with Resend's error names and statuses.
// Shapes follow the docs and OpenAPI spec (github.com/resend/resend-openapi); messages follow
// Resend's where they're documented.

import { htmlToText } from "../../html.ts";
import type { NewAttachment, NewMessage } from "../../message.ts";

export interface ResendError {
  status: 400 | 401 | 403 | 404 | 405 | 409 | 422 | 500;
  name: string;
  message: string;
}

export type Validated =
  | { ok: true; message: Omit<NewMessage, "provider" | "mailbox"> }
  | { ok: false; error: ResendError };

const MAX_RECIPIENTS = 50;
const MAX_SCHEDULE_DAYS = 30;
const TAG = /^[A-Za-z0-9_-]{1,256}$/;
const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$|^[^\s@<>",;]+@localhost$/i;

const invalid = (message: string): Validated => ({
  ok: false,
  error: { status: 422, name: "validation_error", message },
});
const missing = (field: string): Validated => ({
  ok: false,
  error: {
    status: 422,
    name: "missing_required_field",
    message: `Missing \`${field}\` field.`,
  },
});

/** `a@b.com` or `Name <a@b.com>` (the name may be quoted). */
export function validAddress(v: string): boolean {
  const s = v.trim();
  const angle = /^(.*?)\s*<([^<>]+)>$/.exec(s);
  return ADDRESS.test(angle ? angle[2]!.trim() : s);
}

function addressList(
  body: Record<string, unknown>,
  field: string,
): string[] | Validated {
  const v = body[field];
  if (v === undefined || v === null) return [];
  const list = typeof v === "string" ? [v] : v;
  if (!Array.isArray(list) || list.some((x) => typeof x !== "string"))
    return invalid(
      `The \`${field}\` field must be a \`string\` or an array of strings.`,
    );
  const bad = (list as string[]).find((a) => !validAddress(a));
  if (bad !== undefined)
    return invalid(
      `Invalid \`${field}\` field. The email address needs to follow the \`email@example.com\` or \`Name <email@example.com>\` format.`,
    );
  return list as string[];
}

/**
 * ISO 8601, or the natural language Resend accepts ("in 1 min", "in 2 hours", "tomorrow at 9am"
 * is not attempted). Returns an ISO string, or null if it can't be read.
 */
export function parseSchedule(v: string, now = Date.now()): string | null {
  const rel =
    /^in\s+(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i.exec(
      v.trim(),
    );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase()[0]!;
    const ms = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
    return new Date(now + n * ms).toISOString();
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function decodeBase64(s: string): Uint8Array {
  const comma = s.startsWith("data:") ? s.indexOf(",") : -1;
  return new Uint8Array(Buffer.from(comma >= 0 ? s.slice(comma + 1) : s, "base64"));
}

function filenameFromUrl(u: string): string | null {
  try {
    const last = new URL(u).pathname.split("/").pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

const typeOf = (filename: string | null) => {
  if (!filename) return null;
  const t = Bun.file(filename).type;
  return t === "application/octet-stream" ? null : t.replace(/;.*$/, "");
};

export function validateEmail(
  input: unknown,
  opts: { batch: boolean; now?: number },
): Validated {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("The request body must be a JSON object.");
  const body = input as Record<string, unknown>;

  const template = body.template;
  if (template !== undefined && template !== null) {
    if (typeof template !== "object" || typeof (template as { id?: unknown }).id !== "string")
      return invalid("The `template` field must be an object with an `id`.");
    if (body.html !== undefined || body.text !== undefined || body.react !== undefined)
      return invalid(
        "`html`, `text` and `react` can't be sent with a `template`.",
      );
  }
  const usesTemplate = template !== undefined && template !== null;

  if (body.from === undefined || body.from === null || body.from === "") {
    if (!usesTemplate) return missing("from");
  } else if (typeof body.from !== "string" || !validAddress(body.from))
    return invalid(
      "Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.",
    );

  if (body.to === undefined || body.to === null || (Array.isArray(body.to) && !body.to.length))
    return missing("to");
  const to = addressList(body, "to");
  if (!Array.isArray(to)) return to;
  if (to.length > MAX_RECIPIENTS)
    return invalid(
      `Too many recipients. The \`to\` field accepts at most ${MAX_RECIPIENTS} addresses.`,
    );
  const cc = addressList(body, "cc");
  if (!Array.isArray(cc)) return cc;
  const bcc = addressList(body, "bcc");
  if (!Array.isArray(bcc)) return bcc;
  const replyTo = addressList(body, "reply_to");
  if (!Array.isArray(replyTo)) return replyTo;

  if (body.subject === undefined || body.subject === null) {
    if (!usesTemplate) return missing("subject");
  } else if (typeof body.subject !== "string")
    return invalid("The `subject` field must be a `string`.");

  for (const f of ["html", "text"] as const)
    if (body[f] !== undefined && body[f] !== null && typeof body[f] !== "string")
      return invalid(`The \`${f}\` field must be a \`string\`.`);

  const headers: Array<{ name: string; value: string }> = [];
  if (body.headers !== undefined && body.headers !== null) {
    if (typeof body.headers !== "object" || Array.isArray(body.headers))
      return invalid("The `headers` field must be an object.");
    for (const [name, value] of Object.entries(body.headers))
      headers.push({ name, value: String(value) });
  }

  let scheduledAt: string | null = null;
  if (body.scheduled_at !== undefined && body.scheduled_at !== null) {
    if (typeof body.scheduled_at !== "string")
      return invalid("The `scheduled_at` field must be a `string`.");
    const now = opts.now ?? Date.now();
    scheduledAt = parseSchedule(body.scheduled_at, now);
    if (!scheduledAt)
      return invalid(
        "Invalid `scheduled_at` field. Use an ISO 8601 date or natural language such as `in 1 min`.",
      );
    if (Date.parse(scheduledAt) > now + MAX_SCHEDULE_DAYS * 86_400_000)
      return invalid(
        `The \`scheduled_at\` field can't be more than ${MAX_SCHEDULE_DAYS} days in the future.`,
      );
  }

  const attachments: NewAttachment[] = [];
  if (body.attachments !== undefined && body.attachments !== null) {
    if (opts.batch)
      return invalid("The `attachments` field is not supported in batch emails.");
    if (!Array.isArray(body.attachments))
      return invalid("The `attachments` field must be an array.");
    for (const a of body.attachments as Array<Record<string, unknown>>) {
      const content = typeof a?.content === "string" ? a.content : null;
      const path = typeof a?.path === "string" ? a.path : null;
      if (!content && !path)
        return {
          ok: false,
          error: {
            status: 422,
            name: "invalid_attachment",
            message: "Attachment must have either a `content` or `path`.",
          },
        };
      const filename =
        typeof a.filename === "string" ? a.filename : path ? filenameFromUrl(path) : null;
      const contentId = typeof a.content_id === "string" ? a.content_id : null;
      attachments.push({
        filename,
        contentType:
          typeof a.content_type === "string" ? a.content_type : typeOf(filename),
        contentId,
        disposition: contentId ? "inline" : "attachment",
        content: content ? decodeBase64(content) : null,
        url: content ? null : path,
      });
    }
  }

  let tags: Array<{ name: string; value: string }> | null = null;
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags))
      return invalid("The `tags` field must be an array.");
    tags = [];
    for (const t of body.tags as Array<Record<string, unknown>>) {
      if (typeof t?.name !== "string" || typeof t?.value !== "string")
        return invalid("Each tag needs a `name` and a `value`.");
      if (!TAG.test(t.name) || !TAG.test(t.value))
        return invalid(
          "Tags should only contain ASCII letters (a–z, A–Z), numbers (0–9), underscores (_), or dashes (-), and can contain no more than 256 characters.",
        );
      tags.push({ name: t.name, value: t.value });
    }
  }

  const html = typeof body.html === "string" ? body.html : null;
  let text = typeof body.text === "string" ? body.text : null;
  // Resend generates the text part from the HTML unless the sender opts out with text: ""
  const textGenerated = body.text === undefined && html !== null;
  if (textGenerated) text = htmlToText(html);
  if (text === "") text = null;

  let subject = typeof body.subject === "string" ? body.subject : "";
  const tpl = usesTemplate
    ? {
        id: (template as { id: string }).id,
        variables:
          ((template as { variables?: unknown }).variables as Record<string, unknown>) ?? {},
      }
    : null;
  // Hosted templates can't be rendered here: keep the id and variables, readable as text, so
  // the dashboard shows them and code extraction can see them.
  if (tpl) {
    if (!subject) subject = `(template ${tpl.id})`;
    text = [
      `Resend template ${tpl.id}`,
      "",
      ...Object.entries(tpl.variables).map(([k, v]) => `${k}: ${String(v)}`),
    ].join("\n");
  }

  return {
    ok: true,
    message: {
      from: typeof body.from === "string" ? body.from : "",
      to,
      cc,
      bcc,
      replyTo,
      envelope: null,
      subject,
      html,
      text,
      headers,
      messageId: `<${crypto.randomUUID()}@devmailbox.local>`,
      scheduledAt,
      attachments,
      raw: null,
      providerData: {
        lastEvent:
          scheduledAt && Date.parse(scheduledAt) > (opts.now ?? Date.now())
            ? "scheduled"
            : "delivered",
        tags,
        template: tpl,
        topicId: typeof body.topic_id === "string" ? body.topic_id : null,
        textGenerated,
      },
    },
  };
}
