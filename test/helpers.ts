// A real server (HTTP + SMTP) on free ports with an in-memory database, per test file.

import { join } from "node:path";
import { start, type AppOptions, type Running } from "../server/app.ts";
import { DEFAULTS, type Config } from "../server/config.ts";

/** No dashboard build unless a test supplies one, so results don't depend on web/dist. */
export async function startServer(
  over: Partial<Config> = {},
  opts: AppOptions = { webDir: join(import.meta.dir, "no-dashboard") },
): Promise<Running> {
  return start(
    {
      ...DEFAULTS,
      host: "127.0.0.1",
      port: 0,
      smtpPort: 0,
      dataDir: ":memory:",
      ...over,
    },
    opts,
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
