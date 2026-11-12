// WebMCP: when the browser exposes navigator.modelContext, register tools so an agent driving this
// page can search mail and take codes from what it sees. Read-only.

import { api } from "./api.ts";

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface ModelContext {
  registerTool?: (tool: ModelContextTool) => { unregister?: () => void } | void;
  unregisterTool?: (name: string) => void;
}

const text = (v: unknown) => ({
  content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});

export function registerWebMcp(): () => void {
  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!mc?.registerTool) return () => {};
  const tools: ModelContextTool[] = [
    {
      name: "devmailbox_search",
      description:
        "Search caught email across every mailbox, newest first. Query: to:, from:, subject:, mailbox:, has:attachment and bare words.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      execute: async (i) => text((await api.messages(String(i.query ?? ""), null, 20)).data),
    },
    {
      name: "devmailbox_get_message",
      description: "One email: addresses, subject, text body and attachments.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute: async (i) => {
        const { html: _html, ...m } = await api.message(String(i.id));
        return text(m);
      },
    },
    {
      name: "devmailbox_extract",
      description: "The one-time code and verification link found in an email, with other candidates.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute: async (i) => text(await api.extract(String(i.id))),
    },
  ];
  const handles = tools.map((t) => mc.registerTool!(t));
  return () =>
    handles.forEach((h, i) => (h && h.unregister ? h.unregister() : mc.unregisterTool?.(tools[i]!.name)));
}
