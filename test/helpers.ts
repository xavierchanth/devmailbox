// A real server (HTTP + SMTP) on free ports with an in-memory database, per test file.

import { start, type Running } from "../server/app.ts";
import { DEFAULTS, type Config } from "../server/config.ts";

export async function startServer(over: Partial<Config> = {}): Promise<Running> {
  return start({
    ...DEFAULTS,
    host: "127.0.0.1",
    port: 0,
    smtpPort: 0,
    dataDir: ":memory:",
    ...over,
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
