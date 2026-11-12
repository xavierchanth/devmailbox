// Resend compatibility, three ways: the real `resend` SDK pointed at devmailbox, raw fetch for
// what the SDK hides (status codes, error key order, content type), and responses checked against
// Resend's published OpenAPI schemas (test/fixtures/resend-openapi, MIT, commit 0b2a456).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { Resend } from "resend";
import spec from "./fixtures/resend-openapi/resend.json";
import { startServer } from "./helpers.ts";
import type { Running } from "../server/app.ts";

let server: Running;
let base = "";
const sdk = (key = "re_slot1", baseUrl = `${base}/resend`) => new Resend(key, { baseUrl });

beforeAll(async () => {
  server = await startServer();
  base = server.url;
});
afterAll(() => server.stop());

/** fetch a Resend endpoint, returning status, headers, the raw text and parsed JSON. */
async function raw(path: string, init: RequestInit & { key?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.key !== null) headers.set("authorization", `Bearer ${init.key ?? "re_slot1"}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${base}/resend${path}`, { ...init, headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: JSON.parse(text) };
}

const email = {
  from: "Acme <onboarding@acme.test>",
  to: "dev@align.test",
  subject: "Your code",
  html: "<p>Your code is <strong>123456</strong></p>",
};

// ---------- contract: responses match Resend's OpenAPI schemas ----------

/**
 * The spec marks nothing required and nothing nullable, though the real API returns null for
 * empty fields. Check the other way round: every documented field is present, null allowed.
 */
function strictish(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictish);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = strictish(v);
  if (out.type === "object" && out.properties)
    out.required = Object.keys(out.properties as object);
  if (typeof out.type === "string" && out.type !== "object") out.type = [out.type, "null"];
  if (out.enum) out.enum = [...(out.enum as unknown[]), null];
  return out;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: "resend", components: strictish(spec.components) });
const conforms = (name: string, value: unknown) => {
  const validate = ajv.getSchema(`resend#/components/schemas/${name}`)!;
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
};

// ---------- tests ----------

describe("POST /emails", () => {
  test("the SDK sends, and reads it back", async () => {
    const r = sdk();
    const { data, error } = await r.emails.send({ ...email, tags: [{ name: "category", value: "otp" }] });
    expect(error).toBeNull();
    const got = await r.emails.get(data!.id);
    expect(got.error).toBeNull();
    expect(got.data).toMatchObject({
      object: "email",
      id: data!.id,
      from: email.from,
      to: ["dev@align.test"],
      subject: "Your code",
      html: email.html,
      text: "Your code is 123456",
      last_event: "delivered",
      tags: [{ name: "category", value: "otp" }],
    });
    expect(got.data!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00$/);
    conforms("Email", got.data);
  });

  test("lands in the mailbox the key names, visible in /api", async () => {
    const { data } = await sdk("re_mailbox-a").emails.send(email);
    const m = await (await fetch(`${base}/api/messages/${data!.id}`)).json();
    expect(m).toMatchObject({ mailbox: "mailbox-a", provider: "resend" });
  });

  test("no Authorization header at all goes to default", async () => {
    const r = await raw("/emails", { method: "POST", body: JSON.stringify(email), key: null });
    expect(r.status).toBe(200);
    conforms("SendEmailResponse", r.json);
    const m = await (await fetch(`${base}/api/messages/${r.json.id}`)).json();
    expect(m.mailbox).toBe("default");
  });

  test("cc, bcc, reply_to, headers and attachments", async () => {
    const r = sdk("re_attach");
    const { data, error } = await r.emails.send({
      ...email,
      cc: ["a@align.test"],
      bcc: "b@align.test",
      replyTo: "Support <help@acme.test>",
      headers: { "X-Entity-Ref-ID": "123" },
      html: '<p>Logo: <img src="cid:logo"></p>',
      attachments: [
        { filename: "notes.txt", content: Buffer.from("hello") },
        { filename: "logo.png", content: Buffer.from([0x89, 0x50]), contentId: "logo" },
        { path: "https://files.example.test/report.pdf" },
      ],
    });
    expect(error).toBeNull();
    const got = (await r.emails.get(data!.id)).data!;
    expect(got).toMatchObject({ cc: ["a@align.test"], bcc: ["b@align.test"], reply_to: ["Support <help@acme.test>"] });
    const m = await (await fetch(`${base}/api/messages/${data!.id}`)).json();
    expect(m.headers).toEqual([{ name: "X-Entity-Ref-ID", value: "123" }]);
    expect(m.attachments).toMatchObject([
      { filename: "notes.txt", contentType: "text/plain", disposition: "attachment", size: 5 },
      { filename: "logo.png", contentType: "image/png", contentId: "logo", disposition: "inline" },
      { filename: "report.pdf", url: "https://files.example.test/report.pdf", size: 0 },
    ]);
    const file = await fetch(`${base}/api/messages/${data!.id}/attachments/${m.attachments[0].id}`);
    expect(await file.text()).toBe("hello");
    const list = await raw(`/emails/${data!.id}/attachments`, { key: "re_attach" });
    expect(list.json.data).toHaveLength(3);
    expect(list.json.data[0].download_url).toBe(`${base}/api/messages/${data!.id}/attachments/${m.attachments[0].id}`);
  });

  test("text: '' opts out of the generated text part", async () => {
    const { data } = await sdk().emails.send({ ...email, text: "" });
    expect((await sdk().emails.get(data!.id)).data!.text).toBeNull();
  });

  test("templates are stored with their variables", async () => {
    const r = await raw("/emails", {
      method: "POST",
      body: JSON.stringify({ from: email.from, to: email.to, template: { id: "otp-email", variables: { CODE: 654321 } } }),
    });
    expect(r.status).toBe(200);
    const m = await (await fetch(`${base}/api/messages/${r.json.id}/extract`)).json();
    expect(m.code).toBe("654321");
  });
});

describe("errors", () => {
  test("missing field: Resend's body, key order and content type", async () => {
    const r = await raw("/emails", { method: "POST", body: JSON.stringify({ from: email.from, subject: "x", html: "x" }) });
    expect(r.status).toBe(422);
    expect(r.text).toBe('{"statusCode":422,"message":"Missing `to` field.","name":"missing_required_field"}');
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  test("the SDK passes the error through unchanged", async () => {
    const { data, error } = await sdk().emails.send({ ...email, to: "not-an-address" });
    expect(data).toBeNull();
    expect(error).toMatchObject({ statusCode: 422, name: "validation_error" });
    expect(error!.message).toContain("`to`");
  });

  for (const [name, body, status, errName] of [
    ["bad from", { ...email, from: "nobody" }, 422, "validation_error"],
    ["too many recipients", { ...email, to: Array.from({ length: 51 }, (_, i) => `u${i}@align.test`) }, 422, "validation_error"],
    ["bad tag", { ...email, tags: [{ name: "has space", value: "x" }] }, 422, "validation_error"],
    ["attachment without content or path", { ...email, attachments: [{ filename: "a.txt" }] }, 422, "invalid_attachment"],
    ["template with html", { ...email, template: { id: "t" } }, 422, "validation_error"],
    ["schedule too far out", { ...email, scheduled_at: "2099-01-01T00:00:00Z" }, 422, "validation_error"],
  ] as const)
    test(name, async () => {
      const r = await raw("/emails", { method: "POST", body: JSON.stringify(body) });
      expect([r.status, r.json.name]).toEqual([status, errName]);
    });

  test("invalid JSON", async () => {
    const r = await raw("/emails", { method: "POST", body: "{nope" });
    expect([r.status, r.json.name]).toEqual([422, "validation_error"]);
  });

  test("ids, unknown endpoints and methods", async () => {
    expect((await raw("/emails/nope")).json).toMatchObject({ statusCode: 422, name: "invalid_parameter" });
    expect((await raw(`/emails/${crypto.randomUUID()}`)).json).toMatchObject({ statusCode: 404, name: "not_found" });
    expect((await raw("/domains")).json).toEqual({
      statusCode: 404,
      message: "The requested endpoint does not exist.",
      name: "not_found",
    });
    expect((await raw("/emails", { method: "DELETE" })).json).toMatchObject({ statusCode: 405, name: "method_not_allowed" });
  });

  test("reads are scoped to the key's mailbox, like an account", async () => {
    const { data } = await sdk("re_owner").emails.send(email);
    expect((await sdk("re_owner").emails.get(data!.id)).data?.id).toBe(data!.id);
    expect((await sdk("re_someone-else").emails.get(data!.id)).error).toMatchObject({ statusCode: 404 });
  });
});

describe("base URL", () => {
  test("a trailing slash works", async () => {
    const { error } = await sdk("re_slot1", `${base}/resend/`).emails.send(email);
    expect(error).toBeNull();
  });

  test("forgetting /resend gets an error that says so", async () => {
    const { error } = await sdk("re_slot1", base).emails.send(email);
    expect(error).toMatchObject({ statusCode: 404, name: "not_found" });
    expect(error!.message).toContain("/resend");
  });
});

describe("POST /emails/batch", () => {
  const good = (n: number) => ({ ...email, subject: `batch ${n}` });
  const bad = { ...email, to: "nope" };

  test("sends in order", async () => {
    const { data, error } = await sdk("re_batch").batch.send([good(1), good(2)]);
    expect(error).toBeNull();
    expect(data!.data).toHaveLength(2);
    const subjects = await Promise.all(
      data!.data.map(async (d) => (await sdk("re_batch").emails.get(d.id)).data!.subject),
    );
    expect(subjects).toEqual(["batch 1", "batch 2"]);
  });

  test("strict: one bad email fails the batch and nothing is stored", async () => {
    const before = (await sdk("re_strict").emails.list()).data!.data.length;
    const { error } = await sdk("re_strict").batch.send([good(1), bad]);
    expect(error).toMatchObject({ statusCode: 422, name: "validation_error" });
    expect((await sdk("re_strict").emails.list()).data!.data.length).toBe(before);
  });

  test("permissive: valid ones are sent, errors carry their index", async () => {
    const { data, error } = await sdk("re_perm").batch.send([good(1), bad, good(3)], {
      batchValidation: "permissive",
    });
    expect(error).toBeNull();
    expect(data!.data).toHaveLength(2);
    expect((data as unknown as { errors: Array<{ index: number }> }).errors).toMatchObject([{ index: 1 }]);
  });

  test("attachments aren't allowed in batches; limit of 100", async () => {
    const att = await raw("/emails/batch", {
      method: "POST",
      body: JSON.stringify([{ ...email, attachments: [{ filename: "a", content: "eA==" }] }]),
    });
    expect(att.json.name).toBe("validation_error");
    const many = await raw("/emails/batch", { method: "POST", body: JSON.stringify(Array(101).fill(email)) });
    expect([many.status, many.json.name]).toEqual([422, "validation_error"]);
  });

  test("raw response matches the spec", async () => {
    const r = await raw("/emails/batch", { method: "POST", body: JSON.stringify([good(1)]) });
    conforms("CreateBatchEmailsResponse", r.json);
  });
});

describe("Idempotency-Key", () => {
  test("same key and body replays the first response; nothing is sent twice", async () => {
    const r = sdk("re_idem");
    const key = crypto.randomUUID();
    const a = await r.emails.send(email, { idempotencyKey: key });
    const b = await r.emails.send(email, { idempotencyKey: key });
    expect(b.data!.id).toBe(a.data!.id);
    expect((await r.emails.list()).data!.data).toHaveLength(1);
  });

  test("same key, different body: 409", async () => {
    const r = sdk("re_idem2");
    const key = crypto.randomUUID();
    await r.emails.send(email, { idempotencyKey: key });
    const { error } = await r.emails.send({ ...email, subject: "changed" }, { idempotencyKey: key });
    expect(error).toMatchObject({ statusCode: 409, name: "invalid_idempotent_request" });
  });

  test("keys are per mailbox and per endpoint", async () => {
    const key = crypto.randomUUID();
    const a = await sdk("re_k1").emails.send(email, { idempotencyKey: key });
    const b = await sdk("re_k2").emails.send(email, { idempotencyKey: key });
    expect(b.data!.id).not.toBe(a.data!.id);
    const batch = await sdk("re_k1").batch.send([email], { idempotencyKey: key });
    expect(batch.error).toBeNull();
  });

  test("a failed request doesn't use up the key", async () => {
    const r = sdk("re_idem3");
    const key = crypto.randomUUID();
    expect((await r.emails.send({ ...email, to: "bad" }, { idempotencyKey: key })).error).not.toBeNull();
    expect((await r.emails.send(email, { idempotencyKey: key })).error).toBeNull();
  });

  test("length is checked", async () => {
    const r = await raw("/emails", {
      method: "POST",
      body: JSON.stringify(email),
      headers: { "idempotency-key": "x".repeat(257) },
    });
    expect([r.status, r.json.name]).toEqual([400, "invalid_idempotency_key"]);
  });
});

describe("GET /emails", () => {
  test("newest first, with after/before cursors", async () => {
    const r = sdk("re_list");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await r.emails.send({ ...email, subject: `n${i}` })).data!.id);
    const newest = [...ids].reverse();

    const p1 = (await r.emails.list({ limit: 2 })).data!;
    expect(p1.data.map((e) => e.id)).toEqual(newest.slice(0, 2));
    expect(p1.has_more).toBe(true);
    const p2 = (await r.emails.list({ limit: 2, after: p1.data[1]!.id })).data!;
    expect(p2.data.map((e) => e.id)).toEqual(newest.slice(2, 4));
    const p3 = (await r.emails.list({ limit: 2, after: p2.data[1]!.id })).data!;
    expect(p3.data.map((e) => e.id)).toEqual(newest.slice(4));
    expect(p3.has_more).toBe(false);
    const back = (await r.emails.list({ limit: 2, before: p3.data[0]!.id })).data!;
    expect(back.data.map((e) => e.id)).toEqual(newest.slice(2, 4));
    expect(back.has_more).toBe(true);
  });

  test("items match the spec, without html/text; empty lists are null", async () => {
    const r = await raw("/emails?limit=1", { key: "re_list" });
    // The spec types list items as full Emails; the docs example and the SDK's ListEmail type
    // leave out object, html and text. We follow the docs and SDK.
    conforms("ListEmailsResponse", {
      ...r.json,
      data: r.json.data.map((i: object) => ({ object: "email", html: null, text: null, ...i })),
    });
    expect(r.json.object).toBe("list");
    expect(r.json.data[0]).not.toHaveProperty("html");
    expect(r.json.data[0].cc).toBeNull();
  });

  test("limit bounds and exclusive cursors", async () => {
    expect((await raw("/emails?limit=101")).json.name).toBe("validation_error");
    expect((await raw("/emails?after=a&before=b")).json.name).toBe("validation_error");
  });
});

describe("scheduling", () => {
  test("scheduled, rescheduled, canceled; visible straight away", async () => {
    const r = sdk("re_sched");
    const { data } = await r.emails.send({ ...email, scheduledAt: "in 1 hour" });
    let got = (await r.emails.get(data!.id)).data!;
    expect(got.last_event).toBe("scheduled");
    expect(got.scheduled_at).not.toBeNull();

    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const upd = await r.emails.update({ id: data!.id, scheduledAt: at });
    expect(upd.data).toEqual({ object: "email", id: data!.id });
    got = (await r.emails.get(data!.id)).data!;
    expect(got.scheduled_at!.slice(0, 19)).toBe(at.slice(0, 19).replace("T", " "));

    expect((await r.emails.cancel(data!.id)).data).toEqual({ object: "email", id: data!.id });
    expect((await r.emails.get(data!.id)).data!.last_event).toBe("canceled");
    expect((await r.emails.cancel(data!.id)).error).toMatchObject({ statusCode: 422 });

    const m = await (await fetch(`${base}/api/messages?q=mailbox:sched`)).json();
    expect(m.data).toHaveLength(1);
  });
});
