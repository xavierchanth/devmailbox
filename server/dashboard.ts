// The dashboard at /: the built UI (web/dist, or embedded in the compiled binary), or, when it
// hasn't been built, a page that says how to send mail here and read it.

import type { Context } from "hono";
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { WEB_ASSETS } from "./web-assets.ts";

export const WEB_DIST = join(import.meta.dir, "..", "web", "dist");

/** The dashboard runs its own code only. Email HTML is framed from /api, under its own CSP. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "frame-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** A built file: embedded in the binary, or under `dir` (web/dist) when running from source. */
function file(path: string, dir: string | null): string | null {
  if (!dir) return WEB_ASSETS?.[path] ?? null;
  const p = normalize(join(dir, path));
  if (!p.startsWith(dir + sep)) return null;
  return existsSync(p) && statSync(p).isFile() ? p : null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `dir`: where the built dashboard is; null for the copy embedded in the binary. */
export function dashboard(
  c: Context,
  info: Record<string, unknown>,
  dir: string | null = WEB_ASSETS ? null : WEB_DIST,
): Response {
  const path = new URL(c.req.url).pathname;
  const found = file(path === "/" ? "/index.html" : path, dir);
  if (found) {
    const f = Bun.file(found);
    const page = found.endsWith(".html");
    return new Response(f, {
      headers: {
        "content-type": f.type,
        "x-content-type-options": "nosniff",
        // built assets have content hashes in their names
        "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        ...(page ? { "content-security-policy": CSP, "referrer-policy": "no-referrer" } : {}),
      },
    });
  }
  if (path !== "/") return c.text("not found", 404);
  return placeholder(c, info);
}

function placeholder(c: Context, info: Record<string, unknown>): Response {
  const providers = info.providers as Record<string, Record<string, string>>;
  const smtp = info.smtp as { host: string; port: number } | null;
  const env = Object.values(providers)
    .flatMap((p) => Object.entries(p).map(([k, v]) => `${k}=${v}`))
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>devmailbox</title>
<style>
:root { color-scheme: light dark; --fg: #1b1b1f; --bg: #fbfbfc; --muted: #6b6b76; --code: #f0f0f3; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e8ec; --bg: #131316; --muted: #9a9aa5; --code: #1f1f24; } }
body { font: 15px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 46rem; margin: 3rem auto; padding: 0 16px; }
h1 { font-size: 1.4rem; margin-bottom: .2rem; } h2 { font-size: 1rem; margin-top: 2rem; }
p.muted { color: var(--muted); margin-top: 0; }
pre, code { font: 13px/1.5 ui-monospace, monospace; background: var(--code); border-radius: 6px; }
pre { padding: .75rem 1rem; overflow-x: auto; } code { padding: .1rem .3rem; }
a { color: inherit; }
</style></head><body>
<h1>devmailbox</h1>
<p class="muted">Catches your dev environment's email. The dashboard isn't built (<code>just build-web</code>); everything below works.</p>
<h2>Send mail here</h2>
<pre>${esc(env)}</pre>
${smtp ? `<p>SMTP: <code>${esc(smtp.host)}:${smtp.port}</code>, no TLS, any or no credentials (the username picks the mailbox).</p>` : ""}
<h2>Read it</h2>
<ul>
<li><a href="/api/messages">/api/messages</a> — search with <code>?q=to:dev@example.test</code></li>
<li><a href="/api/openapi.json">/api/openapi.json</a> — the API</li>
<li>MCP: <code>claude mcp add --transport http devmailbox ${esc(String(info.mcp))}</code></li>
</ul>
</body></html>`;
  return c.html(html);
}
