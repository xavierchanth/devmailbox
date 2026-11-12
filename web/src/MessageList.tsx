// The unified inbox: newest first, every mailbox and way in together.

import { CalendarClock, Paperclip } from "lucide-react";
import type { MessageSummary } from "./api.ts";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { cn } from "./lib/cn.ts";
import { ago, displayName, fullTime, useNow, writeRoute } from "./ui.tsx";

export function MessageList({
  messages,
  selected,
  loading,
  hasMore,
  onMore,
  filtered,
}: {
  messages: MessageSummary[];
  selected: string | null;
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  filtered: boolean;
}) {
  const now = useNow();
  if (loading && !messages.length)
    return <p className="m-0 p-5 text-sm text-muted-foreground">Loading…</p>;
  if (!messages.length)
    return (
      <p className="m-0 p-5 text-sm text-muted-foreground">
        {filtered ? "Nothing matches this search." : "No mail yet."}
      </p>
    );
  return (
    <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
      {messages.map((m) => (
        <li key={m.id} className="border-b border-border">
          <button
            type="button"
            aria-current={m.id === selected ? "true" : undefined}
            onClick={() => writeRoute({ m: m.id })}
            className={cn(
              "flex w-full flex-col gap-0.5 border-0 bg-transparent px-4 py-3 text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              m.id === selected && "bg-accent",
            )}
          >
            <span className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium" title={m.from}>
                {displayName(m.from) || "(no sender)"}
              </span>
              <time dateTime={m.createdAt} title={fullTime(m.createdAt)} className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {ago(m.createdAt, now)}
              </time>
            </span>
            <span className="truncate text-sm">{m.subject || "(no subject)"}</span>
            <span className="truncate text-xs text-muted-foreground">
              to {m.to.join(", ") || "(no recipients)"}
              {m.snippet ? ` · ${m.snippet}` : ""}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <Badge variant="outline">{m.mailbox}</Badge>
              {m.provider !== "resend" && <Badge variant="outline">{m.provider}</Badge>}
              {m.scheduledAt && (
                <Badge variant="warning">
                  <CalendarClock />
                  scheduled
                </Badge>
              )}
              {m.attachmentCount > 0 && (
                <Badge variant="outline">
                  <Paperclip />
                  {m.attachmentCount}
                </Badge>
              )}
            </span>
          </button>
        </li>
      ))}
      {hasMore && (
        <li className="p-4 text-center">
          <Button size="sm" onClick={onMore}>
            Load older
          </Button>
        </li>
      )}
    </ul>
  );
}
