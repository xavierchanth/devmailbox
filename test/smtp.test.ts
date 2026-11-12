// The SMTP sink, driven by nodemailer: with and without AUTH, multipart with attachments, and
// the result read back through /api.

import { afterAll, beforeAll, expect, test } from "bun:test";
import nodemailer from "nodemailer";
import type { Running } from "../server/app.ts";
import { startServer } from "./helpers.ts";

let server: Running;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.stop());

const transport = (auth?: { user: string; pass: string }) =>
  nodemailer.createTransport({ host: "127.0.0.1", port: server.smtpPort!, secure: false, ignoreTLS: true, auth });
const api = async (path: string) => (await fetch(`${server.url}${path}`)).json();

test("without AUTH: lands in default, envelope kept", async () => {
  const info = await transport().sendMail({
    from: "Supabase Auth <noreply@mail.app.supabase.io>",
    to: "dev@northwind.test",
    bcc: "hidden@northwind.test",
    subject: "Your Northwind code",
    html: "<p>Your Northwind code is</p><p>482913</p>",
  });
  expect(info.rejected).toEqual([]);
  const { data } = await api(`/api/messages?q=${encodeURIComponent("to:hidden@northwind.test")}`);
  expect(data).toHaveLength(1);
  const m = await api(`/api/messages/${data[0].id}`);
  expect(m).toMatchObject({
    mailbox: "default",
    provider: "smtp",
    from: "Supabase Auth <noreply@mail.app.supabase.io>",
    to: ["dev@northwind.test"],
    subject: "Your Northwind code",
    envelope: { from: "noreply@mail.app.supabase.io", to: ["dev@northwind.test", "hidden@northwind.test"] },
    hasRaw: true,
    providerData: { authenticated: false },
  });
  expect(m.messageId).toBe(info.messageId);
  const raw = await (await fetch(`${server.url}/api/messages/${m.id}/raw`)).text();
  expect(raw).toContain("Subject: Your Northwind code");
  expect((await api(`/api/messages/${m.id}/extract`)).code).toBe("482913");
});

test("with AUTH: any credentials, the username picks the mailbox", async () => {
  await transport({ user: "slot7", pass: "whatever" }).sendMail({
    from: "a@acme.test",
    to: ["x@northwind.test", "Y <y@northwind.test>"],
    cc: "z@northwind.test",
    subject: "multipart",
    text: "plain part",
    html: '<p>html part <img src="cid:pic@acme"></p>',
    attachments: [
      { filename: "notes.txt", content: "attached text" },
      { filename: "pic.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), cid: "pic@acme" },
    ],
  });
  const { data } = await api("/api/messages?q=mailbox:slot7");
  const m = await api(`/api/messages/${data[0].id}`);
  expect(m).toMatchObject({
    to: ["x@northwind.test", "Y <y@northwind.test>"],
    cc: ["z@northwind.test"],
    text: "plain part",
    providerData: { authenticated: true },
  });
  expect(m.html).toContain("html part");
  // in MIME order: the inline part (multipart/related) comes before the attachment
  const byName = Object.fromEntries(m.attachments.map((a: { filename: string }) => [a.filename, a]));
  expect(byName["notes.txt"]).toMatchObject({ contentType: "text/plain", disposition: "attachment", size: 13 });
  expect(byName["pic.png"]).toMatchObject({ contentType: "image/png", contentId: "pic@acme", disposition: "inline", size: 4 });
  const html = await (await fetch(`${server.url}/api/messages/${m.id}/html`)).text();
  expect(html).toContain(`/api/messages/${m.id}/attachments/${byName["pic.png"].id}`);
  const file = await fetch(`${server.url}/api/messages/${m.id}/attachments/${byName["notes.txt"].id}`);
  expect(await file.text()).toBe("attached text");
});
