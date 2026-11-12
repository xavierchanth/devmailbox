#!/usr/bin/env bun
// devmailbox: a dev mailbox for replicated dev environments.
//   devmailbox serve     run the HTTP server (dashboard, /api, /mcp, provider APIs) and SMTP sink
//   devmailbox doctor    check the configuration and that the ports are free

import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { start } from "./app.ts";
import { configPath, loadConfig, type Config } from "./config.ts";

async function serve(cfg: Config) {
  const running = await start(cfg);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, () => void running.stop().finally(() => process.exit(0)));
  console.log(
    `devmailbox on ${running.url}  (dashboard /, API /api, MCP /mcp, Resend /resend)` +
      (running.smtpPort === null ? "; SMTP off" : `; SMTP on port ${running.smtpPort}`),
  );
  if (cfg.host === "127.0.0.1" || cfg.host === "localhost")
    console.log(
      "listening on this machine only; set DEVMAILBOX_HOST=0.0.0.0 to share it with other machines",
    );
}

const portFree = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createServer()
      .once("error", () => resolve(false))
      .listen(port, host, () => s.close(() => resolve(true)));
  });

async function doctor(cfg: Config) {
  let failed = 0;
  const line = (ok: boolean, label: string, hint = "") => {
    console.log(`${ok ? "✓" : "✗"} ${label}${!ok && hint ? `\n    → ${hint}` : ""}`);
    if (!ok) failed++;
  };
  const file = configPath();
  console.log(`config: ${file}${existsSync(file) ? "" : " (not found; using defaults)"}`);
  console.log(`data:   ${cfg.dataDir}`);
  line(
    await portFree(cfg.host, cfg.port),
    `HTTP port ${cfg.host}:${cfg.port} is free`,
    "something else is listening there (devmailbox already running?); set DEVMAILBOX_PORT",
  );
  if (cfg.smtpPort !== null)
    line(
      await portFree(cfg.host, cfg.smtpPort),
      `SMTP port ${cfg.host}:${cfg.smtpPort} is free`,
      "set DEVMAILBOX_SMTP_PORT, or off",
    );
  console.log(failed ? `\n${failed} problem(s)` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

const cfg = loadConfig();
const cmd = process.argv[2] ?? "serve";
if (cmd === "serve") await serve(cfg);
else if (cmd === "doctor") await doctor(cfg);
else {
  console.error("usage: devmailbox [serve|doctor]");
  process.exit(2);
}
