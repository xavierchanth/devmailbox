# devmailbox

A self-contained dev mailbox for replicated dev environments. Apps send transactional email
(sign-in codes, magic links, invites) to devmailbox instead of a real provider, and nothing is
delivered. People read it in a dashboard; agents read it through an HTTP API and an MCP server,
and can wait for an email and take its one-time code or verification link.

Two ways in:

- **A Resend-compatible API** at `/resend`: point the Resend SDK (or any HTTP client) at it.
- **An SMTP sink**: for stacks like Supabase Auth that send over SMTP.

One port serves everything: the dashboard at `/`, the API at `/api`, MCP at `/mcp` and the
provider APIs at `/<provider>`.

devmailbox is not affiliated with or endorsed by Resend.

> The dashboard isn't built yet; `/` shows how to send and read mail. Everything else works.

## Run it

```sh
bun install
just serve            # HTTP on :7430, SMTP on :2525
```

Or as one binary (`just compile`, then `dist/devmailbox serve`), or a container
(`podman compose -f service/compose.yaml up -d --build`). `devmailbox doctor` checks the setup.

## Send mail to it

**Resend.** Change the base URL; any API key works:

```sh
RESEND_BASE_URL=http://localhost:7430/resend
RESEND_API_KEY=re_slot3          # the part after re_ names the mailbox
```

Supported: `POST /emails`, `POST /emails/batch` (strict and permissive validation),
`GET /emails`, `GET /emails/:id`, `PATCH /emails/:id`, `POST /emails/:id/cancel` and the
attachment endpoints, with Resend's request and response shapes, error bodies and
`Idempotency-Key` handling. Scheduled emails show up straight away, marked as scheduled.
Hosted templates can't be rendered; their id and variables are stored and shown instead.
Tested against the Node SDK (`resend` 6.38); other SDKs work if they append paths to the base
URL the same way.

**SMTP.** Host `localhost`, port `2525`, no TLS. Authentication is optional and any credentials
work; the username names the mailbox.

## Read it

Mail is grouped into **mailboxes**: one per Resend API key or SMTP username, else `default`, so
one shared server can serve many workspaces. Reading is unified: search across every mailbox.

```
to:dev@northwind.test from:supabase subject:"confirm" mailbox:slot3 has:attachment magic link
```

`to:`/`from:`/`subject:` and bare words match substrings, ignoring case; a complete address
matches only that address. Repeating a key ORs; different keys AND. Also `provider:`,
`after:` and `before:`.

**HTTP API** (`/api`, documented at `/api/openapi.json`):

| Endpoint | |
|---|---|
| `GET /api/messages?q=&limit=&cursor=` | Search, newest first |
| `GET /api/messages/:id` | The full message |
| `GET /api/messages/:id/html` | HTML body, sandboxed (see below) |
| `GET /api/messages/:id/raw` | Original source (SMTP) |
| `GET /api/messages/:id/attachments/:aid` | An attachment, as a download |
| `GET /api/messages/:id/extract` | One-time codes and links, best first |
| `GET /api/wait?q=&since=&timeout=` | Long-poll for a matching message; 408 on timeout |
| `GET /api/events?q=` | Server-Sent Events: new and deleted mail |
| `GET /api/mailboxes`, `DELETE /api/mailboxes/:name` | Mailboxes |
| `DELETE /api/messages/:id` | Delete a message |
| `GET /api/info`, `GET /api/health` | Settings for senders and agents; liveness |

**MCP** for agents:

```sh
claude mcp add --transport http devmailbox http://localhost:7430/mcp
```

Tools: `mark_time`, `wait_for_message`, `extract_code`, `extract_links`, `list_messages`,
`get_message`, `list_mailboxes`, `delete_message`, `clear_mailbox`. Install
[`skill/SKILL.md`](skill/SKILL.md) as a skill too; it teaches the workflow.

## Safety

There's no authentication: it's for dev environments. Instead:

- It listens on `127.0.0.1` unless you set `host` (`DEVMAILBOX_HOST=0.0.0.0`). Anyone who can
  reach the port can read the mail, which includes live sign-in links.
- It answers only to known host names (localhost, IP addresses, this machine's name,
  `host.docker.internal`, and `allowedHosts`), which stops DNS rebinding.
- Browsers can't make cross-site requests that change anything.
- Email content is untrusted. HTML is served under a `sandbox` CSP with no scripts, no forms and
  no remote content (remote images only with `?remote=1`), and attachments always download.
- It never makes outbound connections: no relaying, no webhooks, and attachment URLs are
  recorded, not fetched.

## Configuration

Everything works without a config file. To change the defaults, copy
[`service/config.example.json`](service/config.example.json) to
`~/.config/devmailbox/config.json`.

| Key | Default | Environment |
|---|---|---|
| `host` | `127.0.0.1` | `DEVMAILBOX_HOST` |
| `port` | `7430` | `DEVMAILBOX_PORT` |
| `smtpPort` | `2525` (`null` turns SMTP off) | `DEVMAILBOX_SMTP_PORT` (`off`) |
| `dataDir` | `~/.local/state/devmailbox` | `DEVMAILBOX_DATA_DIR` |
| `allowedHosts` | `[]` (`["*"]` turns the check off) | `DEVMAILBOX_ALLOWED_HOSTS` (comma-separated) |
| `baseUrl` | none: the request's own address | `DEVMAILBOX_BASE_URL` |
| `retention.maxMessagesPerMailbox` | `500` | `DEVMAILBOX_MAX_MESSAGES` |
| `retention.maxAgeHours` | `72` | `DEVMAILBOX_MAX_AGE_HOURS` |

`DEVMAILBOX_CONFIG` points at a different config file. [`service/`](service/) has a systemd user
unit, a launchd plist and the container files.

## Development

```sh
just dev          # server, restarting on changes
just test         # everything, end to end; no external services
just check        # typecheck and test, as CI does
```

The server is in `server/` (Bun, Hono, `bun:sqlite`, the MCP SDK). See [AGENTS.md](AGENTS.md)
for how it fits together.
