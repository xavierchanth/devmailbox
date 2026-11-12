// One HTTP server on one port: /mcp, /api, a provider API at each /<provider>, and the dashboard
// at /. Routing goes by the first path segment, so an unknown path under /api, /mcp or a
// provider gets that surface's own 404, never the dashboard.

import { Hono, type Context } from "hono";
import { hostname } from "node:os";
import { isIP } from "node:net";
import { createApi, VERSION } from "./api.ts";
import type { Config } from "./config.ts";
import { dashboard } from "./dashboard.ts";
import { Mail } from "./mail.ts";
import { handleMcp } from "./mcp.ts";
import { PROVIDERS, RESERVED, type Provider } from "./providers/index.ts";
import { startSmtp, type SmtpSink } from "./smtp.ts";
import { Store } from "./store.ts";

/**
 * Host names a browser may use to reach this server. Refusing others stops DNS rebinding: a web
 * page you visit resolving its own name to 127.0.0.1 and reading your mail.
 */
export function hostAllowed(header: string | undefined, cfg: Config): boolean {
  if (!header || cfg.allowedHosts.includes("*")) return true;
  const name = header
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  if (isIP(name)) return true;
  const own = hostname().toLowerCase();
  const known = [
    "localhost",
    own,
    `${own}.local`,
    // apps in containers reaching the host's devmailbox
    "host.docker.internal",
    "host.containers.internal",
    ...cfg.allowedHosts.map((h) => h.toLowerCase()),
  ];
  if (cfg.baseUrl) {
    try {
      known.push(new URL(cfg.baseUrl).hostname.toLowerCase());
    } catch {}
  }
  return known.includes(name) || name.endsWith(".localhost");
}

export function createApp(mail: Mail, smtpPort: () => number | null): Hono {
  const { cfg } = mail;
  const providers = new Map<string, Provider>(
    Object.entries(PROVIDERS).map(([name, make]) => [name, make(mail.forProvider(name))]),
  );
  const info = (origin: string) => {
    const base = cfg.baseUrl?.replace(/\/+$/, "") ?? origin;
    const port = smtpPort();
    return {
      version: VERSION,
      dashboard: `${base}/`,
      api: `${base}/api`,
      openapi: `${base}/api/openapi.json`,
      mcp: `${base}/mcp`,
      providers: Object.fromEntries(
        [...providers].map(([name, p]) => [name, p.describe(base)]),
      ),
      smtp: port === null ? null : { host: new URL(base).hostname, port, auth: "optional; the username picks the mailbox" },
    };
  };
  const api = createApi(mail, info);

  const app = new Hono();
  const first = (c: Context) => new URL(c.req.url).pathname.split("/")[1] ?? "";

  /** A refusal in the format of the surface the request was for. */
  const refuse = (c: Context, message: string) => {
    const seg = first(c);
    const p = providers.get(seg);
    if (p) return p.reject(403, message);
    if (seg === "api" || seg === "mcp")
      return c.json({ error: { code: "forbidden", message } }, 403);
    return c.text(message, 403);
  };

  app.use("*", async (c, next) => {
    if (!hostAllowed(c.req.header("host"), cfg))
      return refuse(
        c,
        `devmailbox doesn't answer to the host name "${c.req.header("host")}". Add it to allowedHosts (DEVMAILBOX_ALLOWED_HOSTS).`,
      );
    // A web page can't use your browser to delete mail or send into it.
    const safe = ["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (!safe && c.req.header("sec-fetch-site") === "cross-site")
      return refuse(c, "cross-site request refused");
    await next();
  });

  app.all("/mcp", (c) => handleMcp(mail, c.req.raw));
  app.all("/mcp/*", (c) =>
    c.json({ error: { code: "not_found", message: "MCP is served at /mcp" } }, 404),
  );
  app.route("/", api);
  for (const [name, p] of providers) app.route(`/${name}`, p.app);

  // A sender that left the provider prefix off its base URL: say how to fix it, in the format
  // its SDK will print.
  const resend = providers.get("resend");
  if (resend) {
    const hint = () =>
      resend.reject(
        404,
        "Not found. devmailbox serves Resend's API under /resend: set RESEND_BASE_URL to <devmailbox>/resend.",
      );
    app.all("/emails", hint);
    app.all("/emails/*", hint);
  }

  app.get("*", (c) => dashboard(c, info(new URL(c.req.url).origin)));
  app.all("*", (c) => c.text("not found", 404));
  return app;
}

export interface Running {
  mail: Mail;
  url: string;
  port: number;
  smtpPort: number | null;
  stop(): Promise<void>;
}

/** Collapse repeated slashes (a base URL ending in "/" plus a path starting with one). */
function normalize(req: Request): Request {
  const url = new URL(req.url);
  if (!url.pathname.includes("//")) return req;
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return new Request(url, req);
}

export async function start(cfg: Config): Promise<Running> {
  if (RESERVED.has("") || Object.keys(PROVIDERS).some((p) => RESERVED.has(p)))
    throw new Error("a provider name collides with a reserved path");
  const mail = new Mail(cfg, new Store(cfg.dataDir));
  let smtp: SmtpSink | null = null;
  const app = createApp(mail, () => smtp?.port ?? null);
  const http = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    // long-polls, SSE and waiting MCP calls (up to MAX_WAIT_MS) hold requests open
    idleTimeout: 255,
    fetch: (req, server) => app.fetch(normalize(req), { server }),
  });
  try {
    if (cfg.smtpPort !== null)
      smtp = await startSmtp(mail, { host: cfg.host, port: cfg.smtpPort });
  } catch (e) {
    void http.stop(true);
    throw e;
  }
  const sweep = setInterval(() => mail.applyRetention(), 10 * 60_000);
  sweep.unref?.();
  const host = cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
  return {
    mail,
    url: `http://${host === "0.0.0.0" || host === "[::]" ? "127.0.0.1" : host}:${http.port}`,
    port: http.port!,
    smtpPort: smtp?.port ?? null,
    async stop() {
      clearInterval(sweep);
      await smtp?.close();
      await http.stop(true);
      mail.store.close();
    },
  };
}
