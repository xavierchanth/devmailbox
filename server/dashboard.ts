// The dashboard at /. Until the UI lands, a page that says how to send mail here and read it.

import type { Context } from "hono";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function dashboard(c: Context, info: Record<string, unknown>): Response {
  const url = new URL(c.req.url);
  if (url.pathname !== "/") return c.text("not found", 404);
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
<p class="muted">Catches your dev environment's email. The dashboard isn't built yet; everything below works.</p>
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
