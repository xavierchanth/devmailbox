// Provider emulations, each mounted at /<name>. A provider owns its whole wire format: routes,
// body parsing, how a request picks a mailbox, error bodies and 404s. It reaches the rest of
// devmailbox only through its ProviderScope, and never makes outbound network calls.

import type { Hono } from "hono";
import type { ProviderScope } from "../mail.ts";
import { createResend } from "./resend/index.ts";

export interface Provider {
  name: string;
  /** Answers every path under /<name>, unknown ones included, in the provider's own format. */
  app: Hono;
  /** A rejection in the provider's own error format, for server-wide checks (Host, origin). */
  reject(status: 403 | 404, message: string): Response;
  /** For /api/info: how a client points at this provider. */
  describe(baseUrl: string): Record<string, string>;
}

export const PROVIDERS: Record<string, (scope: ProviderScope) => Provider> = {
  resend: createResend,
};

/** First path segments that never reach a provider or the dashboard. */
export const RESERVED = new Set(["api", "mcp"]);
