// How to send mail here and read it, from /api/info: shown when there's no mail yet and behind
// the Connect button.

import { Plug } from "lucide-react";
import type { ReactNode } from "react";
import type { Info } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog.tsx";
import { CopyButton } from "./ui.tsx";

function Snippet({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted py-1.5 pr-1.5 pl-3">
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto py-0.5 font-mono text-xs leading-relaxed">{value}</pre>
      <CopyButton value={value} />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-md font-medium">{title}</h3>
      {note && <p className="m-0 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

export function ConnectPanel({ info, intro }: { info: Info; intro?: string }) {
  const resend = info.providers.resend;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {intro && <p className="m-0 text-base text-muted-foreground">{intro}</p>}
      {resend && (
        <Section title="Resend" note="Any API key works. The part after re_ names the mailbox, so each workspace can have its own.">
          <Snippet value={`RESEND_BASE_URL=${resend.RESEND_BASE_URL}\nRESEND_API_KEY=re_dev`} />
        </Section>
      )}
      {info.smtp && (
        <Section
          title="SMTP"
          note="No TLS. Authentication is optional and any credentials work; the username names the mailbox."
        >
          <Snippet value={`${info.smtp.host}:${info.smtp.port}`} />
        </Section>
      )}
      <Section title="Agents" note="Add the MCP server, and install skill/SKILL.md from the devmailbox repository as a skill.">
        <Snippet value={`claude mcp add --transport http devmailbox ${info.mcp}`} />
      </Section>
      <Section
        title="HTTP API"
        note={
          <>
            Search, wait for and read mail over HTTP. See{" "}
            <a href="/api/openapi.json" className="underline underline-offset-2 hover:text-foreground">
              the OpenAPI document
            </a>
            .
          </>
        }
      />
    </div>
  );
}

export function ConnectDialog({ info }: { info: Info }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="default" className="shrink-0">
            <Plug />
            <span className="max-sm:hidden">Connect</span>
          </Button>
        }
      />
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>Send mail here</DialogTitle>
          <DialogDescription>Point your app and agents at devmailbox. Nothing is delivered for real.</DialogDescription>
        </DialogHeader>
        <ConnectPanel info={info} />
      </DialogContent>
    </Dialog>
  );
}
