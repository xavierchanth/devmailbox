// End to end, the way an agent uses it: the real MCP client over Streamable HTTP waits for an
// email while an app sends it with the real Resend SDK (or over SMTP), then takes the code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Running } from "../server/app.ts";
import { sleep, startServer } from "./helpers.ts";

let server: Running;
let client: Client;

beforeAll(async () => {
  server = await startServer();
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
});
afterAll(async () => {
  await client.close();
  await server.stop();
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  const text = r.content[0]!.text;
  return { isError: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
};

/** What the app does: send its sign-in code through Resend. */
const appSendsCode = (key: string, to: string, code: string) =>
  new Resend(key, { baseUrl: `${server.url}/resend` }).emails.send({
    from: "Align <auth@align.test>",
    to,
    subject: "Your Align code",
    html: `<p>Your Align code is</p><p style="font-size:32px">${code}</p><p>It expires in 1 hour.</p>`,
  });

test("lists the tools", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "clear_mailbox",
    "delete_message",
    "extract_code",
    "extract_links",
    "get_message",
    "list_mailboxes",
    "list_messages",
    "mark_time",
    "wait_for_message",
  ]);
});

describe("send, then the agent extracts the code", () => {
  test("waits for the email, ignores another workspace's at the same moment", async () => {
    const { since } = (await call("mark_time")).json;
    const waiting = call("extract_code", { query: "to:agent@align.test", since, timeoutMs: 10_000 });
    await sleep(300);
    await Promise.all([
      appSendsCode("re_slot4", "other-agent@align.test", "111111"),
      appSendsCode("re_slot3", "agent@align.test", "482913"),
    ]);
    const r = await waiting;
    expect(r.isError).toBe(false);
    expect(r.json.code).toBe("482913");
    expect(r.json.message).toMatchObject({ subject: "Your Align code", to: ["agent@align.test"] });
  });

  test("the email arrived before the agent asked", async () => {
    await appSendsCode("re_slot3", "quick@align.test", "975310");
    const r = await call("extract_code", { query: "to:quick@align.test", timeoutMs: 5000 });
    expect(r.json.code).toBe("975310");
  });

  test("an older email isn't mistaken for the new one", async () => {
    await appSendsCode("re_slot3", "again@align.test", "000111");
    const { since } = (await call("mark_time")).json;
    const r = await call("extract_code", { query: "to:again@align.test", since, timeoutMs: 300 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("arrived within");
  });

  test("wait_for_message returns the email with its code and link", async () => {
    const waiting = call("wait_for_message", { query: "to:wait@align.test", timeoutMs: 5000 });
    await sleep(100);
    await appSendsCode("re_slot3", "wait@align.test", "246810");
    const r = await waiting;
    expect(r.json).toMatchObject({ mailbox: "slot3", subject: "Your Align code", code: "246810" });
    expect(r.json.text).toContain("246810");
  });
});

test("Supabase confirm link over SMTP, through extract_links", async () => {
  const link = "http://127.0.0.1:42001/auth/v1/verify?token=pkce_abc&type=signup&redirect_to=http://localhost:3000";
  await nodemailer
    .createTransport({ host: "127.0.0.1", port: server.smtpPort!, secure: false, ignoreTLS: true })
    .sendMail({
      from: "noreply@mail.app.supabase.io",
      to: "signup@align.test",
      subject: "Confirm Your Signup",
      html: `<h2>Confirm your signup</h2><p>Follow this link to confirm your user:</p><p><a href="${link.replace(/&/g, "&amp;")}">Confirm your mail</a></p>`,
    });
  const r = await call("extract_links", { query: "to:signup@align.test", timeoutMs: 5000 });
  expect(r.json.link).toBe(link);
  expect(r.json.links[0]).toMatchObject({ kind: "verification", text: "Confirm your mail" });
});

test("browse, read and clean up", async () => {
  await appSendsCode("re_tidy", "tidy@align.test", "135790");
  const boxes = (await call("list_mailboxes")).json;
  expect(boxes.map((b: { name: string }) => b.name)).toContain("tidy");
  const list = (await call("list_messages", { query: "mailbox:tidy" })).json;
  expect(list.messages).toHaveLength(1);
  const m = (await call("get_message", { id: list.messages[0].id })).json;
  expect(m).not.toHaveProperty("html");
  expect((await call("get_message", { id: m.id, html: true })).json.html).toContain("135790");
  expect((await call("extract_code", { id: m.id })).json.code).toBe("135790");
  expect((await call("clear_mailbox", { mailbox: "tidy" })).json).toEqual({ deleted: 1 });
  expect((await call("get_message", { id: m.id })).isError).toBe(true);
  expect((await call("list_messages", { query: "after:never" })).isError).toBe(true);
});
