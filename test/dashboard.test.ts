// The dashboard at /: the built files with a strict CSP, or the placeholder when it isn't built.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Running } from "../server/app.ts";
import { startServer } from "./helpers.ts";

let built: Running;
let unbuilt: Running;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "devmailbox-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), '<!doctype html><script type="module" src="/assets/app-abc123.js"></script>');
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('dashboard')");
  writeFileSync(join(tmpdir(), "devmailbox-secret.txt"), "outside");
  built = await startServer({}, { webDir: dir });
  unbuilt = await startServer();
});
afterAll(async () => {
  await built.stop();
  await unbuilt.stop();
});

test("serves the built page under a CSP that only runs its own code", async () => {
  const r = await fetch(`${built.url}/`);
  expect(r.headers.get("content-type")).toContain("text/html");
  const csp = r.headers.get("content-security-policy")!;
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(r.headers.get("cache-control")).toBe("no-cache");
  expect(await r.text()).toContain("/assets/app-abc123.js");
});

test("hashed assets are cached for good", async () => {
  const r = await fetch(`${built.url}/assets/app-abc123.js`);
  expect(r.headers.get("content-type")).toContain("javascript");
  expect(r.headers.get("cache-control")).toContain("immutable");
});

test("nothing outside the build directory, and API paths stay the API's", async () => {
  expect((await fetch(`${built.url}/assets/../../devmailbox-secret.txt`)).status).toBe(404);
  expect((await fetch(`${built.url}/%2e%2e/devmailbox-secret.txt`)).status).toBe(404);
  expect((await fetch(`${built.url}/nope`)).status).toBe(404);
  expect(await (await fetch(`${built.url}/api/nope`)).json()).toMatchObject({ error: { code: "not_found" } });
});

test("without a build, / says how to send and read mail", async () => {
  const body = await (await fetch(`${unbuilt.url}/`)).text();
  expect(body).toContain("RESEND_BASE_URL=");
  expect(body).toContain("just build-web");
});
