// The SMTP sink: accepts any message, AUTH LOGIN optional (any credentials; the username picks
// the mailbox), no TLS, no relaying. Stands in for Mailpit/Inbucket, e.g. for Supabase Auth.

import PostalMime, { type Address, type Email } from "postal-mime";
import { SMTPServer } from "smtp-server";
import type { Mail } from "./mail.ts";
import { mailboxFromCredential, type NewMessage } from "./message.ts";

const MAX_SIZE = 50 * 1024 * 1024;

function flatten(list: Address[] | undefined): string[] {
  return (list ?? []).flatMap((a) =>
    "group" in a && a.group ? flatten(a.group) : [format(a)],
  );
}

function format(a: Address): string {
  const address = "address" in a ? (a.address ?? "") : "";
  return a.name ? `${a.name} <${address}>` : address;
}

export function toNewMessage(
  parsed: Email,
  raw: Uint8Array,
  session: { user?: string; envelope: { from: string | null; to: string[] }; remote?: string; helo?: string },
): NewMessage {
  return {
    mailbox: mailboxFromCredential(session.user),
    provider: "smtp",
    from: parsed.from ? format(parsed.from) : (session.envelope.from ?? ""),
    to: flatten(parsed.to),
    cc: flatten(parsed.cc),
    bcc: flatten(parsed.bcc),
    replyTo: flatten(parsed.replyTo),
    envelope: session.envelope,
    subject: parsed.subject ?? "",
    html: parsed.html ?? null,
    text: parsed.text ?? null,
    headers: parsed.headers.map((h) => ({
      name: (h as { originalKey?: string }).originalKey ?? h.key,
      value: h.value,
    })),
    messageId: parsed.messageId ?? null,
    scheduledAt: null,
    attachments: parsed.attachments.map((a) => ({
      filename: a.filename ?? null,
      contentType: a.mimeType ?? null,
      contentId: a.contentId?.replace(/^<|>$/g, "") ?? null,
      disposition: a.disposition === "inline" ? "inline" : "attachment",
      content:
        typeof a.content === "string"
          ? new TextEncoder().encode(a.content)
          : new Uint8Array(a.content),
      url: null,
    })),
    raw,
    providerData: {
      authenticated: !!session.user,
      helo: session.helo ?? null,
      remoteAddress: session.remote ?? null,
    },
  };
}

export interface SmtpSink {
  port: number;
  close(): Promise<void>;
}

export function startSmtp(
  mail: Mail,
  opts: { host: string; port: number },
): Promise<SmtpSink> {
  const server = new SMTPServer({
    name: "devmailbox",
    banner: "devmailbox: dev mail sink, nothing is delivered",
    authOptional: true,
    allowInsecureAuth: true,
    // LOGIN only: Go's net/smtp (gomail, so Supabase Auth) picks PLAIN when offered, then refuses
    // to send it without TLS to anything but localhost.
    authMethods: ["LOGIN"],
    disabledCommands: ["STARTTLS"],
    size: MAX_SIZE,
    logger: false,
    onAuth(auth, _session, cb) {
      cb(null, { user: auth.username || "default" });
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("error", cb);
      stream.on("end", async () => {
        if ((stream as { sizeExceeded?: boolean }).sizeExceeded) {
          const err = new Error("Message too large") as Error & { responseCode: number };
          err.responseCode = 552;
          return cb(err);
        }
        try {
          const raw = new Uint8Array(Buffer.concat(chunks));
          const parsed = await PostalMime.parse(raw);
          const from = session.envelope.mailFrom;
          mail.ingest(
            toNewMessage(parsed, raw, {
              user: typeof session.user === "string" ? session.user : undefined,
              envelope: {
                from: from ? from.address : null,
                to: session.envelope.rcptTo.map((r) => r.address),
              },
              remote: session.remoteAddress,
              helo: session.hostNameAppearsAs,
            }),
          );
          cb();
        } catch (e) {
          console.error("devmailbox: smtp:", e);
          cb(e as Error);
        }
      });
    },
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      server.on("error", (e) => console.error("devmailbox: smtp:", e));
      const addr = server.server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : opts.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
