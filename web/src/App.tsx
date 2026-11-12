// The dashboard: mailboxes on the left, the unified inbox in the middle, the open message on the
// right. The search box drives everything; the sidebar edits its mailbox: term.

import { Search, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatQuery, parseQuery, type Query } from "../../server/query.ts";
import { api, ApiError, useMailEvents, type Info, type Mailbox, type MessageSummary } from "./api.ts";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { NativeSelect } from "./components/ui/native-select.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { ConnectDialog, ConnectPanel } from "./Connect.tsx";
import { readAppearance, saveAppearance, type Appearance } from "./lib/appearance.ts";
import { MessageList } from "./MessageList.tsx";
import { MessageView } from "./MessageView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useRoute, writeRoute } from "./ui.tsx";
import { registerWebMcp } from "./webmcp.ts";

// the review page for the UI kit (#design-system), loaded only when opened
const DesignSystemPage = lazy(() => import("./DesignSystemPage.tsx").then((m) => ({ default: m.DesignSystemPage })));

function parsed(q: string): Query | null {
  try {
    return parseQuery(q);
  } catch {
    return null;
  }
}

/** The query with its mailbox: terms replaced (null: all mailboxes). */
export function withMailbox(q: string, mailbox: string | null): string {
  const p = parsed(q);
  if (!p) return mailbox ? `mailbox:${mailbox}` : "";
  p.mailbox = mailbox ? [mailbox] : [];
  return formatQuery(p);
}

export function App() {
  const route = useRoute();
  useEffect(() => registerWebMcp(), []);
  if (route.page === "design-system")
    return (
      <Suspense>
        <DesignSystemPage />
      </Suspense>
    );
  return (
    <TooltipProvider>
      <Inbox q={route.q} selected={route.m} />
    </TooltipProvider>
  );
}

function Inbox({ q, selected }: { q: string; selected: string | null }) {
  const [search, setSearch] = useState(q);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [info, setInfo] = useState<Info | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const searchRef = useRef<HTMLInputElement>(null);

  // the hash changed (back button, sidebar): follow it
  useEffect(() => setSearch(q), [q]);
  // typing: update the hash shortly after the last keystroke
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => writeRoute({ q: search }, true), 250);
    return () => clearTimeout(t);
  }, [search, q]);

  const loadMailboxes = useCallback(() => {
    api.mailboxes().then(setMailboxes, () => {});
  }, []);
  useEffect(() => {
    loadMailboxes();
    api.info().then(setInfo, () => {});
  }, [loadMailboxes]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    api.messages(q).then(
      (page) => {
        if (stale) return;
        setMessages(page.data);
        setCursor(page.nextCursor);
        setError(null);
        setLoading(false);
      },
      (e: Error) => {
        if (stale) return;
        setMessages([]);
        setCursor(null);
        setError(e instanceof ApiError && e.code === "bad_query" ? e.message : `Couldn't load mail: ${e.message}`);
        setLoading(false);
      },
    );
    return () => {
      stale = true;
    };
  }, [q]);

  const loadMore = () => {
    if (!cursor) return;
    api.messages(q, cursor).then((page) => {
      setMessages((list) => [...list, ...page.data.filter((m) => !list.some((x) => x.id === m.id))]);
      setCursor(page.nextCursor);
    });
  };

  // live updates; mailbox counts refresh at most twice a second
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connection = useMailEvents(error ? "" : q, (e) => {
    if (error) return;
    if (e.type === "message.created")
      setMessages((list) => (list.some((m) => m.id === e.message.id) ? list : [e.message, ...list]));
    else if (e.type === "message.deleted") setMessages((list) => list.filter((m) => m.id !== e.id));
    else setMessages((list) => list.filter((m) => m.mailbox !== e.mailbox));
    countsTimer.current ??= setTimeout(() => {
      countsTimer.current = null;
      loadMailboxes();
    }, 500);
  });

  // "/" focuses search, Escape closes the open message
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && !typing && selected) writeRoute({ m: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const query = useMemo(() => parsed(q), [q]);
  const activeMailbox = query?.mailbox.length === 1 ? query.mailbox[0]! : null;
  const empty = !loading && !error && !messages.length;
  const noMailAtAll = empty && !q && !mailboxes.some((m) => m.messages > 0);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-5">
        <a href="#" className="shrink-0 text-md font-semibold tracking-tight" onClick={() => writeRoute({ q: "", m: null })}>
          devmailbox<span className="text-muted-foreground">.</span>
        </a>
        <div className="relative mx-auto w-full max-w-2xl">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search mail"
            placeholder="Search: to:dev@example.test from: subject: mailbox: has:attachment"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
              onClick={() => {
                setSearch("");
                writeRoute({ q: "" }, true);
              }}
            >
              <X />
            </Button>
          )}
        </div>
        <ConnectionBadge state={connection} />
        {info && <ConnectDialog info={info} />}
        <NativeSelect
          size="sm"
          aria-label="Appearance"
          className="w-24 max-sm:hidden"
          value={appearance}
          onChange={(e) => {
            const a = e.target.value as Appearance;
            setAppearance(a);
            saveAppearance(a);
          }}
        >
          <option value="auto">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </NativeSelect>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          mailboxes={mailboxes}
          active={activeMailbox}
          onSelect={(name) => writeRoute({ q: withMailbox(q, name), m: null })}
          onCleared={loadMailboxes}
        />
        <section
          aria-label="Messages"
          className={`flex min-w-0 flex-col border-r border-border md:w-96 md:shrink-0 max-md:flex-1 ${selected ? "max-md:hidden" : ""}`}
        >
          <MobileMailboxPicker mailboxes={mailboxes} active={activeMailbox} q={q} />
          {error ? (
            <div role="alert" className="m-4 rounded-lg border border-warning-border bg-warning px-3 py-2.5 text-sm text-warning-foreground">
              {error}
            </div>
          ) : (
            <MessageList
              messages={messages}
              selected={selected}
              loading={loading}
              hasMore={!!cursor}
              onMore={loadMore}
              filtered={!!q}
            />
          )}
        </section>
        <main className={`min-w-0 flex-1 ${selected ? "" : "max-md:hidden"}`}>
          {selected ? (
            <MessageView key={selected} id={selected} />
          ) : noMailAtAll && info ? (
            <div className="h-full overflow-y-auto p-6 md:p-10">
              <ConnectPanel info={info} intro="No mail yet. Point your app here and it shows up straight away." />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {empty ? "" : "Select a message to read it."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ConnectionBadge({ state }: { state: "connecting" | "live" | "offline" }) {
  if (state === "live")
    return (
      <Badge variant="success" className="shrink-0 max-sm:hidden" title="New mail appears as it arrives">
        Live
      </Badge>
    );
  return (
    <Badge variant="warning" className="shrink-0" title="Live updates are reconnecting">
      {state === "offline" ? "Offline" : "Reconnecting"}
    </Badge>
  );
}

/** The sidebar's job on phones. */
function MobileMailboxPicker({ mailboxes, active, q }: { mailboxes: Mailbox[]; active: string | null; q: string }) {
  return (
    <div className="border-b border-border p-3 md:hidden">
      <NativeSelect
        size="sm"
        aria-label="Mailbox"
        value={active ?? ""}
        onChange={(e) => writeRoute({ q: withMailbox(q, e.target.value || null), m: null })}
      >
        <option value="">All mail</option>
        {mailboxes.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} ({m.messages})
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
