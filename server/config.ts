// Server settings: a JSON file (optional) with DEVMAILBOX_* environment overrides.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  /** Listen address. Loopback by default: mail holds live sign-in links. */
  host: string;
  /** HTTP port for the dashboard, /api, /mcp and the provider APIs. */
  port: number;
  /** SMTP port. null turns the SMTP sink off. */
  smtpPort: number | null;
  /** Holds devmailbox.db. ":memory:" keeps everything in memory. */
  dataDir: string;
  /**
   * Host header names accepted besides localhost and IP addresses, e.g. "mail.example.test".
   * The check stops DNS rebinding; "*" turns it off.
   */
  allowedHosts: string[];
  /** The address other machines use, e.g. http://mail.example.test:7430. Shown in /api/info. */
  baseUrl: string | null;
  retention: {
    /** Oldest messages beyond this many per mailbox are deleted. 0 disables. */
    maxMessagesPerMailbox: number;
    /** Messages older than this are deleted. 0 disables. */
    maxAgeHours: number;
  };
}

export const DEFAULTS: Config = {
  host: "127.0.0.1",
  port: 7430,
  smtpPort: 2525,
  dataDir: join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "devmailbox",
  ),
  allowedHosts: [],
  baseUrl: null,
  retention: { maxMessagesPerMailbox: 500, maxAgeHours: 72 },
};

export function configPath(): string {
  return (
    process.env.DEVMAILBOX_CONFIG ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      "devmailbox",
      "config.json",
    )
  );
}

const expand = (p: string) =>
  p === ":memory:"
    ? p
    : p.startsWith("~/")
      ? join(homedir(), p.slice(2))
      : resolve(p);

const num = (v: string | undefined) =>
  v === undefined || v === "" ? undefined : Number(v);

const list = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(
  file = configPath(),
  env: Record<string, string | undefined> = process.env,
): Config {
  const raw: Partial<Config> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const smtp = env.DEVMAILBOX_SMTP_PORT;
  return {
    host: env.DEVMAILBOX_HOST ?? raw.host ?? DEFAULTS.host,
    port: num(env.DEVMAILBOX_PORT) ?? raw.port ?? DEFAULTS.port,
    smtpPort:
      smtp === "off"
        ? null
        : (num(smtp) ??
          (raw.smtpPort === undefined ? DEFAULTS.smtpPort : raw.smtpPort)),
    dataDir: expand(
      env.DEVMAILBOX_DATA_DIR ?? raw.dataDir ?? DEFAULTS.dataDir,
    ),
    allowedHosts:
      list(env.DEVMAILBOX_ALLOWED_HOSTS) ??
      raw.allowedHosts ??
      DEFAULTS.allowedHosts,
    baseUrl: env.DEVMAILBOX_BASE_URL ?? raw.baseUrl ?? DEFAULTS.baseUrl,
    retention: {
      maxMessagesPerMailbox:
        num(env.DEVMAILBOX_MAX_MESSAGES) ??
        raw.retention?.maxMessagesPerMailbox ??
        DEFAULTS.retention.maxMessagesPerMailbox,
      maxAgeHours:
        num(env.DEVMAILBOX_MAX_AGE_HOURS) ??
        raw.retention?.maxAgeHours ??
        DEFAULTS.retention.maxAgeHours,
    },
  };
}
