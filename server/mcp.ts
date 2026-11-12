// MCP over Streamable HTTP at /mcp (stateless: one server per request). The tools cover what an
// agent needs to get through a sign-up or sign-in flow: wait for the email, take the code or link.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { extracted, VERSION } from "./api.ts";
import { BadRequest, MAX_WAIT_MS, type Mail } from "./mail.ts";
import type { Message } from "./message.ts";
import { parseQuery, QueryError } from "./query.ts";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

class ToolError extends Error {}

async function guard(fn: () => unknown): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ToolError || err instanceof BadRequest || err instanceof QueryError)
      return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}

const query = z
  .string()
  .optional()
  .describe(
    'Search across every mailbox: to:, from:, subject:, mailbox:, provider:, has:attachment, after:, before: and bare words. Usually to:<the address you signed up with>, e.g. "to:dev@align.test subject:confirm".',
  );
const since = z
  .string()
  .optional()
  .describe(
    "Only mail after this: the `since` from mark_time (taken before you triggered the email), an ISO time, or a message id. Default: the last 30 seconds.",
  );
const timeoutMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_WAIT_MS)
  .default(30_000)
  .describe(`How long to wait for a matching email, in ms (max ${MAX_WAIT_MS}). 0: don't wait.`);
const id = z.string().describe("A message id (from list_messages or wait_for_message)");

/** A message as agents see it: the readable parts, without HTML unless asked. */
function forAgent(m: Message, html = false) {
  return {
    id: m.id,
    mailbox: m.mailbox,
    provider: m.provider,
    createdAt: m.createdAt,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    text: m.text,
    ...(html ? { html: m.html } : {}),
    attachments: m.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
    scheduledAt: m.scheduledAt,
  };
}

export function buildMcpServer(mail: Mail): McpServer {
  const server = new McpServer({ name: "devmailbox", version: VERSION });
  const { store } = mail;

  /** The message an extraction tool reads: by id, or the newest match (waiting if needed). */
  async function target(a: { id?: string; query?: string; since?: string; timeoutMs: number }) {
    if (a.id) {
      const m = store.get(a.id);
      if (!m) throw new ToolError(`no message ${a.id}`);
      return m;
    }
    const m = await mail.waitFor(parseQuery(a.query), mail.resolveSince(a.since), a.timeoutMs);
    if (!m)
      throw new ToolError(
        `no email matching "${a.query ?? ""}" arrived within ${a.timeoutMs / 1000}s. Check the address, that the app sends to devmailbox, and since.`,
      );
    return m;
  }

  server.registerTool(
    "mark_time",
    {
      description:
        "The server's current time. Call it before triggering an email (sign-up, password reset) and pass the result as `since` to wait_for_message or extract_code, so an older email can't be mistaken for the new one.",
    },
    () => guard(() => ({ since: new Date().toISOString() })),
  );

  server.registerTool(
    "list_mailboxes",
    {
      description:
        "Mailboxes with message counts. A mailbox is picked by the sender's API key (re_slot3 → slot3) or SMTP username; otherwise mail lands in default.",
    },
    () => guard(() => store.mailboxes()),
  );

  server.registerTool(
    "list_messages",
    {
      description: "Search messages across every mailbox, newest first.",
      inputSchema: {
        query,
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional().describe("nextCursor from the previous call"),
      },
    },
    ({ query, limit, cursor }) =>
      guard(() => {
        const page = store.search(parseQuery(query), { limit, cursor });
        return {
          messages: page.data,
          nextCursor: page.hasMore ? page.data.at(-1)!.id : null,
        };
      }),
  );

  server.registerTool(
    "get_message",
    {
      description: "One message: headers summary, text body and attachments; HTML on request.",
      inputSchema: { id, html: z.boolean().default(false).describe("Include the HTML body") },
    },
    ({ id, html }) =>
      guard(() => {
        const m = store.get(id);
        if (!m) throw new ToolError(`no message ${id}`);
        return forAgent(m, html);
      }),
  );

  server.registerTool(
    "wait_for_message",
    {
      description:
        "Wait for the newest email matching query that arrived after since, and return it with any code and verification link found in it. Returns at once if one already has.",
      inputSchema: { query, since, timeoutMs },
    },
    (a) =>
      guard(async () => {
        const m = await target(a);
        const { code, link } = extracted(m);
        return { ...forAgent(m), code, link };
      }),
  );

  server.registerTool(
    "extract_code",
    {
      description:
        "The one-time code (OTP) from an email: a given message, or the newest matching query after since, waiting for it if needed. Returns the best code and the other candidates with context.",
      inputSchema: { query, since, timeoutMs, id: id.optional() },
    },
    (a) =>
      guard(async () => {
        const m = await target(a);
        const e = extracted(m);
        if (!e.code)
          throw new ToolError(
            `no code found in "${m.subject}" (${m.id}). Its text:\n${(m.text ?? "").slice(0, 2000)}`,
          );
        return {
          code: e.code,
          candidates: e.codes.slice(0, 5).map(({ value, context }) => ({ value, context })),
          message: { id: m.id, subject: m.subject, to: m.to, createdAt: m.createdAt },
        };
      }),
  );

  server.registerTool(
    "extract_links",
    {
      description:
        "Links from an email, verification/sign-in/reset links first: a given message, or the newest matching query after since, waiting for it if needed.",
      inputSchema: { query, since, timeoutMs, id: id.optional() },
    },
    (a) =>
      guard(async () => {
        const m = await target(a);
        const e = extracted(m);
        return {
          link: e.link,
          links: e.links.map(({ url, text, kind }) => ({ url, text, kind })),
          message: { id: m.id, subject: m.subject, to: m.to, createdAt: m.createdAt },
        };
      }),
  );

  server.registerTool(
    "delete_message",
    { description: "Delete one message.", inputSchema: { id } },
    ({ id }) =>
      guard(() => {
        if (!mail.deleteMessage(id)) throw new ToolError(`no message ${id}`);
        return { deleted: true };
      }),
  );

  server.registerTool(
    "clear_mailbox",
    {
      description:
        "Delete a mailbox and all its messages. Only clear mail you own: other people and agents may share this server.",
      inputSchema: { mailbox: z.string() },
    },
    ({ mailbox }) =>
      guard(() => {
        const n = mail.deleteMailbox(mailbox);
        if (n === null) throw new ToolError(`no mailbox ${mailbox}`);
        return { deleted: n };
      }),
  );

  return server;
}

export async function handleMcp(mail: Mail, request: Request): Promise<Response> {
  const server = buildMcpServer(mail);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // stateless: the response is fully built (enableJsonResponse), so tear down
    void transport.close();
    void server.close();
  }
}
