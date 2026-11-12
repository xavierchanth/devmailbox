// One message: who and when, the code and link found in it, then its HTML, text, headers, source
// and attachments. HTML renders in a sandboxed iframe; the server adds a sandbox CSP as well.

import { ArrowLeft, Download, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Extracted, type Message } from "./api.ts";
import { Badge } from "./components/ui/badge.tsx";
import { Button, buttonVariants } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Label } from "./components/ui/field.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip.tsx";
import { CopyButton, fullTime, writeRoute } from "./ui.tsx";

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function MessageView({ id }: { id: string }) {
  const [m, setM] = useState<Message | null>(null);
  const [x, setX] = useState<Extracted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.message(id), api.extract(id)]).then(
      ([message, extracted]) => {
        setM(message);
        setX(extracted);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  if (error)
    return (
      <Pane>
        <BackButton />
        <p className="m-0 text-sm text-muted-foreground">This message is gone: {error}.</p>
      </Pane>
    );
  if (!m) return <Pane>{null}</Pane>;

  const people: Array<[string, string]> = [
    ["From", m.from],
    ["To", m.to.join(", ")],
    ["Cc", m.cc.join(", ")],
    ["Bcc", m.bcc.join(", ")],
    ["Reply-To", m.replyTo.join(", ")],
  ];
  const tabs = [
    m.html !== null && "html",
    "text",
    "headers",
    m.hasRaw && "raw",
    m.attachments.length > 0 && "attachments",
    "details",
  ].filter((t): t is string => !!t);

  return (
    <Pane>
      <BackButton />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-lg font-semibold tracking-tight break-words">{m.subject || "(no subject)"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{m.mailbox}</Badge>
            <Badge variant="outline">{m.provider}</Badge>
            {m.scheduledAt && <Badge variant="warning">scheduled for {fullTime(m.scheduledAt)}</Badge>}
            {typeof m.providerData.lastEvent === "string" && m.providerData.lastEvent !== "delivered" && (
              <Badge variant="outline">{m.providerData.lastEvent}</Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {m.hasRaw && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a href={api.rawUrl(m.id)} download className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Download .eml">
                    <Download />
                  </a>
                }
              />
              <TooltipContent>Download .eml</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete message"
                  onClick={() => void api.deleteMessage(m.id).then(() => writeRoute({ m: null }))}
                >
                  <Trash2 />
                </Button>
              }
            />
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {people
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Row key={k} label={k}>
              {v}
            </Row>
          ))}
        <Row label="Date">
          <time dateTime={m.createdAt}>{fullTime(m.createdAt)}</time>
        </Row>
      </dl>

      {x && (x.code || x.link) && <Found x={x} />}

      <Tabs defaultValue={tabs[0]} className="min-h-0 flex-1">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t === "html" ? "HTML" : t === "raw" ? "Source" : t[0]!.toUpperCase() + t.slice(1)}
              {t === "attachments" && ` (${m.attachments.length})`}
            </TabsTrigger>
          ))}
        </TabsList>
        {m.html !== null && (
          <TabsContent value="html" className="flex min-h-0 flex-1 flex-col gap-3">
            <HtmlBody id={m.id} />
          </TabsContent>
        )}
        <TabsContent value="text">
          {m.text ? <Pre>{m.text}</Pre> : <Note>No text part.</Note>}
        </TabsContent>
        <TabsContent value="headers">
          {m.headers.length ? (
            <Card>
              <dl className="m-0 divide-y divide-border">
                {m.headers.map((h, i) => (
                  <div key={i} className="grid grid-cols-[minmax(8rem,14rem)_1fr] gap-4 px-4 py-2 text-xs max-sm:grid-cols-1 max-sm:gap-0.5">
                    <dt className="font-mono text-muted-foreground">{h.name}</dt>
                    <dd className="m-0 font-mono break-all">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <Note>No custom headers were sent.</Note>
          )}
        </TabsContent>
        {m.hasRaw && (
          <TabsContent value="raw">
            <RawSource id={m.id} />
          </TabsContent>
        )}
        {m.attachments.length > 0 && (
          <TabsContent value="attachments">
            <Card>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {m.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{a.filename ?? "(unnamed)"}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          a.contentType,
                          a.url ? "URL only, not fetched" : size(a.size),
                          a.disposition === "inline" ? `inline${a.contentId ? ` (cid:${a.contentId})` : ""}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
                        <ExternalLink />
                        Open URL
                      </a>
                    ) : (
                      <a href={api.attachmentUrl(m.id, a.id)} download className={buttonVariants({ size: "sm" })}>
                        <Download />
                        Download
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="details">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row label="ID">
              <span className="font-mono text-xs">{m.id}</span>
            </Row>
            {m.messageId && (
              <Row label="Message-ID">
                <span className="font-mono text-xs">{m.messageId}</span>
              </Row>
            )}
            {m.envelope && (
              <Row label="Envelope">
                from {m.envelope.from ?? "(none)"} to {m.envelope.to.join(", ")}
              </Row>
            )}
            <Row label="Size">{size(m.size)}</Row>
          </dl>
          <div className="mt-4 mb-2 text-xs text-muted-foreground">Provider data ({m.provider})</div>
          <Pre>{JSON.stringify(m.providerData, null, 2)}</Pre>
        </TabsContent>
      </Tabs>
    </Pane>
  );
}

function Pane({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col gap-5 overflow-y-auto px-5 py-5 md:px-8 md:py-6">{children}</div>;
}

function BackButton() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit md:hidden" onClick={() => writeRoute({ m: null })}>
      <ArrowLeft />
      Inbox
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

const Pre = ({ children }: { children: string }) => (
  <pre className="m-0 overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
    {children}
  </pre>
);

const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-sm text-muted-foreground">{children}</p>;

/** The best code and verification link, ready to copy. */
function Found({ x }: { x: Extracted }) {
  const others = x.codes.slice(1, 4).map((c) => c.value);
  return (
    <Card className="divide-y divide-border">
      {x.code && (
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="w-10 shrink-0 text-xs text-muted-foreground">Code</span>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xl tracking-[0.2em]">{x.code}</span>
            {others.length > 0 && <div className="text-xs text-muted-foreground">Also found: {others.join(", ")}</div>}
          </div>
          <CopyButton value={x.code} size="sm" label="Copy code">
            Copy
          </CopyButton>
        </div>
      )}
      {x.link && (
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="w-10 shrink-0 text-xs text-muted-foreground">Link</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={x.link}>
            {x.link}
          </span>
          <div className="flex shrink-0 gap-2">
            <CopyButton value={x.link} size="sm" label="Copy link">
              Copy
            </CopyButton>
            <a href={x.link} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
              <ExternalLink />
              Open
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

function HtmlBody({ id }: { id: string }) {
  const [remote, setRemote] = useState(false);
  return (
    <>
      <Label className="text-sm text-muted-foreground">
        <Switch checked={remote} onCheckedChange={setRemote} />
        Load remote images
      </Label>
      {/* Emails are designed for a white page, whatever the dashboard's theme. */}
      <iframe
        title="Message HTML"
        sandbox=""
        referrerPolicy="no-referrer"
        src={api.htmlUrl(id, remote)}
        className="min-h-[60vh] w-full flex-1 rounded-lg border border-border bg-white"
      />
    </>
  );
}

function RawSource({ id }: { id: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  useEffect(() => {
    api.raw(id).then(setRaw, (e: Error) => setRaw(`Couldn't load the source: ${e.message}`));
  }, [id]);
  return raw === null ? <Note>Loading…</Note> : <Pre>{raw}</Pre>;
}
