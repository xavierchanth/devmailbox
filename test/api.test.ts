// /api end to end: the unified inbox, sandboxed content, wait, live events, and the server-wide
// Host and cross-site checks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { Resend } from "resend";
import type { Running } from "../server/app.ts";
import { sleep, startServer } from "./helpers.ts";

let server: Running;
let base = "";

beforeAll(async () => {
  server = await startServer({ allowedHosts: ["mail.example.ts.net"] });
  base = server.url;
});
afterAll(() => server.stop());

const send = async (key: string, over: Record<string, unknown> = {}) => {
  const { data, error } = await new Resend(key, { baseUrl: `${base}/resend` }).emails.send({
    from: "Acme <auth@acme.test>",
    to: "dev@align.test",
    subject: "Hello",
    text: "hi",
    ...over,
  } as never);
  if (error) throw new Error(error.message);
  return data!.id;
};
const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base}${path}`, init);
  const type = res.headers.get("content-type") ?? "";
  return { res, body: type.includes("json") ? await res.json() : await res.text() };
};

/** A request with an arbitrary Host header (fetch won't let us set one). */
function withHost(path: string, host: string, method = "GET") {
  const url = new URL(path, base);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: url.pathname, method, headers: { host } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("server", () => {
  test("health, info and the OpenAPI document", async () => {
    expect((await get("/api/health")).body).toMatchObject({ ok: true });
    const info = (await get("/api/info")).body;
    expect(info.providers.resend.RESEND_BASE_URL).toBe(`${base}/resend`);
    expect(info.smtp.port).toBe(server.smtpPort);
    expect(info.mcp).toBe(`${base}/mcp`);
    const doc = (await get("/api/openapi.json")).body;
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/messages", "/api/messages/{id}/html", "/api/wait"]),
    );
  });

  test("each surface answers its own 404s", async () => {
    expect((await get("/api/nope")).body).toEqual({ error: { code: "not_found", message: "no such endpoint" } });
    expect((await get("/api/messages/nope")).res.status).toBe(404);
    expect((await get("/mcp/extra")).res.status).toBe(404);
    expect((await get("/nope")).res.status).toBe(404);
    const home = await get("/");
    expect(home.res.headers.get("content-type")).toContain("text/html");
    expect(home.body).toContain("RESEND_BASE_URL=");
  });

  test("repeated slashes are collapsed", async () => {
    expect((await get("//api//health")).res.status).toBe(200);
  });
});

describe("unified inbox", () => {
  test("searches across mailboxes and ways in, newest first, paged", async () => {
    const a = await send("re_inbox-a", { subject: "Welcome aboard", to: "new@align.test" });
    const b = await send("re_inbox-b", { subject: "Welcome back", to: "new@align.test" });
    await send("re_inbox-b", { subject: "Unrelated", to: "other@align.test" });

    const all = (await get(`/api/messages?q=${encodeURIComponent("to:new@align.test")}`)).body;
    expect(all.data.map((m: { id: string }) => m.id)).toEqual([b, a]);
    expect(all.data[0]).toMatchObject({ mailbox: "inbox-b", provider: "resend", subject: "Welcome back" });

    const p1 = (await get(`/api/messages?q=welcome&limit=1`)).body;
    expect(p1).toMatchObject({ hasMore: true, nextCursor: b });
    const p2 = (await get(`/api/messages?q=welcome&limit=1&cursor=${p1.nextCursor}`)).body;
    expect(p2.data[0].id).toBe(a);

    const boxes = (await get("/api/mailboxes")).body.data;
    expect(boxes.find((m: { name: string }) => m.name === "inbox-b").messages).toBe(2);
  });

  test("a bad query is a 400 that says why", async () => {
    const r = await get("/api/messages?q=after:whenever");
    expect(r.res.status).toBe(400);
    expect(r.body.error.code).toBe("bad_query");
  });

  test("delete a message, then a mailbox", async () => {
    const id = await send("re_trash");
    await send("re_trash");
    expect((await get(`/api/messages/${id}`, { method: "DELETE" })).body).toEqual({ deleted: true });
    expect((await get(`/api/messages/${id}`)).res.status).toBe(404);
    expect((await get("/api/mailboxes/trash", { method: "DELETE" })).body).toEqual({ deleted: 1 });
    expect((await get("/api/mailboxes/trash", { method: "DELETE" })).res.status).toBe(404);
  });
});

describe("sandboxed content", () => {
  test("HTML is served under a sandbox CSP with cid: images rewritten", async () => {
    const id = await send("re_html", {
      html: '<p>Hi <img src="cid:logo"><img src="https://tracker.example/p.gif"><script>alert(1)</script></p>',
      attachments: [{ filename: "logo.png", content: Buffer.from([1, 2]), contentId: "logo" }],
    });
    const m = (await get(`/api/messages/${id}`)).body;
    const r = await get(`/api/messages/${id}/html`);
    const csp = r.res.headers.get("content-security-policy")!;
    expect(csp).toStartWith("sandbox;");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("https:");
    expect(csp).not.toContain("script-src");
    expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.body).toContain(`src="/api/messages/${id}/attachments/${m.attachments[0].id}"`);
    const remote = await get(`/api/messages/${id}/html?remote=1`);
    expect(remote.res.headers.get("content-security-policy")).toContain("https:");
  });

  test("attachments always download, even HTML ones", async () => {
    const id = await send("re_html", {
      attachments: [{ filename: "page.html", content: Buffer.from("<script>alert(1)</script>") }],
    });
    const att = (await get(`/api/messages/${id}`)).body.attachments[0];
    const r = await fetch(`${base}/api/messages/${id}/attachments/${att.id}`);
    expect(r.headers.get("content-disposition")).toStartWith("attachment;");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
  });

  test("raw source only exists for SMTP mail", async () => {
    const id = await send("re_html");
    expect((await get(`/api/messages/${id}/raw`)).res.status).toBe(404);
    expect((await get(`/api/messages/${id}/html`)).res.status).toBe(404);
  });
});

describe("wait", () => {
  test("waits for mail that hasn't arrived yet", async () => {
    const t0 = Date.now();
    const waiting = get(`/api/wait?q=${encodeURIComponent("to:late@align.test")}&timeout=5000`);
    await sleep(200);
    const id = await send("re_wait", { to: "late@align.test" });
    const r = await waiting;
    expect(r.res.status).toBe(200);
    expect(r.body.id).toBe(id);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test("returns at once for mail that beat the waiter", async () => {
    const id = await send("re_wait", { to: "early@align.test" });
    const r = await get(`/api/wait?q=to:early@align.test&timeout=5000`);
    expect(r.body.id).toBe(id);
  });

  test("since excludes older mail", async () => {
    const old = await send("re_wait", { to: "since@align.test" });
    const r = await get(`/api/wait?q=to:since@align.test&since=${old}&timeout=100`);
    expect(r.res.status).toBe(408);
    expect(r.body.error.code).toBe("timeout");
  });

  test("ignores mail that doesn't match", async () => {
    const waiting = get(`/api/wait?q=${encodeURIComponent("to:me@align.test subject:code")}&timeout=1500`);
    await sleep(100);
    await send("re_wait", { to: "me@align.test", subject: "newsletter" });
    await send("re_wait", { to: "someone@align.test", subject: "code" });
    const id = await send("re_wait", { to: "me@align.test", subject: "your code" });
    expect((await waiting).body.id).toBe(id);
  });
});

describe("events", () => {
  test("SSE streams matching new mail", async () => {
    const res = await fetch(`${base}/api/events?q=${encodeURIComponent("mailbox:live")}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let buf = "";
    const until = async (needle: string) => {
      while (!buf.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += new TextDecoder().decode(value);
      }
    };
    await until("event: ready");
    await send("re_elsewhere", { subject: "not for this stream" });
    const id = await send("re_live", { subject: "for the stream" });
    await until(id);
    expect(buf).toContain("event: message.created");
    expect(buf).not.toContain("not for this stream");
    await reader.cancel();
  });
});

describe("host and origin checks", () => {
  test("unknown Host names are refused, in each surface's format", async () => {
    const api = await withHost("/api/health", "evil.example");
    expect(api.status).toBe(403);
    expect(JSON.parse(api.body).error.code).toBe("forbidden");
    const resend = await withHost("/resend/emails", "evil.example");
    expect(JSON.parse(resend.body)).toMatchObject({ statusCode: 403, name: "validation_error" });
  });

  test("localhost, IPs, container gateways and configured names are fine", async () => {
    for (const host of ["localhost:7430", "127.0.0.1", "[::1]:7430", "host.docker.internal", "app.localhost", "mail.example.ts.net"])
      expect((await withHost("/api/health", host)).status).toBe(200);
  });

  test("cross-site browser requests can't change anything", async () => {
    const id = await send("re_xsite");
    const r = await get(`/api/messages/${id}`, { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } });
    expect(r.res.status).toBe(403);
    expect((await get(`/api/messages/${id}`, { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } })).res.status).toBe(200);
    const read = await get(`/api/messages`, { headers: { "sec-fetch-site": "cross-site" } });
    expect(read.res.status).toBe(200);
  });
});
