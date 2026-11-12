# devmailbox: project brief

Starting brief from the planning conversation on 2026-11-12. Nothing is built yet. This records
what the project is for and the decisions already made, so the build can start from here.

## What it is

A self-contained dev mailbox for replicated dev environments. Apps in a dev workspace send
transactional email (auth codes, magic links, invites) to devmailbox instead of a real provider.
People see it in a web dashboard, and agents read it through an API and an MCP server. For
example, an agent can grab the newest OTP for `dev@align.test` to finish a sign-up flow.

## Decisions made

| Topic      | Decision                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Name       | `devmailbox`. "devbox" was rejected because it suggests a developer machine.                   |
| Repo       | `github.com/xavierchanth/devmailbox`, private for now, public later                            |
| VCS        | jj, colocated with git                                                                         |
| Stack      | Bun + Hono + `bun:sqlite` + MCP TypeScript SDK on the server; React + Vite dashboard           |
| Packaging  | One image/binary (`bun build --compile` and a small container image) that serves the dashboard, `/api` and `/mcp` from one port |
| Deployment | Both modes from the same image: a **per-workspace sidecar** or **one shared server** with a mailbox per workspace |

## Ingestion: two ways in

1. **Resend-compatible HTTP API.** This is the main path; the user mostly sends with Resend.
   Implement enough of Resend's API that the official SDK and raw `fetch` callers work just by
   changing the base URL (the Resend Node SDK reads `RESEND_BASE_URL`):
   - `POST /emails`, `POST /emails/batch`, `GET /emails/:id`, `GET /emails` (list)
   - The same request/response shapes, status codes and error body (`{ statusCode, name, message }`)
     as Resend, including `Idempotency-Key`, `scheduled_at` (stored, shown as scheduled) and
     `react`-less fields: `html`, `text`, `cc`, `bcc`, `reply_to`, `headers`, `attachments`, `tags`
   - Accept any `Authorization: Bearer <key>`. The key selects the mailbox/workspace (see Tenancy).
   - Check the current Resend API reference before building. Don't work from memory.
2. **SMTP sink.** Some stacks send over SMTP. Align's Supabase Auth does: locally it goes to
   Supabase's bundled Mailpit (`[local_smtp]`), and in production to Amazon SES. devmailbox
   should accept SMTP (AUTH optional, any credentials) so it can stand in for Mailpit/Inbucket.
   It doesn't relay mail onward.

Both paths store the same normalized message (envelope, headers, html, text, attachments, raw
source for SMTP), so the dashboard and MCP don't care how a message arrived.

## Tenancy (mailboxes)

- A **mailbox** is one workspace's mail. It's chosen by the Resend API key (`re_<anything>`), the
  SMTP username, or, failing both, a `default` mailbox.
- Sidecar mode: everything lands in `default`. No setup.
- Shared mode: each workspace gets its own key/SMTP user, so one server serves many devenv slots
  and machines. Mailboxes are created automatically the first time they're used.
- Retention: limit by count and age per mailbox, plus a manual clear.

## Reading: dashboard, API, MCP

- **Dashboard:** mailbox list, then a message list with live updates (SSE). The message view has
  rendered HTML in a sandboxed iframe, text, headers, raw source and attachments. It also shows
  quick-copy buttons for any OTP codes and links it detects.
- **HTTP API** under `/api`: list mailboxes, list/search messages (to, from, subject, since),
  get a message, a `wait` endpoint (long-poll until a matching message arrives), delete/clear.
- **MCP** at `/mcp` (Streamable HTTP), for agents doing auth flows:
  - `list_messages`, `get_message`
  - `wait_for_message({ to?, subject?, since?, timeoutMs })`
  - `extract_code` / `extract_links`: pull the OTP or verification link from the newest match
  - `clear_mailbox`
- An agent **skill** file (`skill/SKILL.md`) that teaches the workflow, the way alignctl does.

## Reference: alignctl (the model to copy)

`~/src/al/align/dev/alignctl` (repo `align-company/align`, private) has the shape this project
should follow. Read its README, `server/` and `web/` before designing:

- Hono server, SQLite, `@modelcontextprotocol/sdk`, React/Vite dashboard. The dashboard,
  `/api` and `/mcp` share one port (`:7420`), and the dashboard also exposes WebMCP tools.
- **Access model worth reusing:** it listens on `127.0.0.1` by default, with per-network
  allow/token rules (`loopback`, `tailscale`, CIDR ranges, "anywhere" always needs a token). A
  generated bearer token, and state-changing requests are refused unless they come from the
  dashboard. Config comes from a JSON file with env var overrides (`ALIGNCTL_*` becomes
  `DEVMAILBOX_*`).
- It ships a systemd user unit, a launchd plist, a Containerfile/compose and a `doctor` command.
- Its tests run end to end with no external services.

devenv (`~/src/al/align/dev/env`) is the replicated environment it drives. Each checkout claims
a **slot** with ports `42000 + N*100 … +99`, and its `ports.ts` already reserves a `mail` offset
(currently Supabase's Mailpit). devenv runs without alignctl, so devmailbox must not depend on
either. Integrating with Align (a devenv service on the slot's `mail` port, Supabase pointed at
devmailbox SMTP, alignctl linking to it) is **later work in the Align repo**, not part of this
repo.

## Suggested first milestone

1. Scaffold: Bun workspace, `server/`, `web/`, `skill/`, `justfile`, README, AGENTS.md.
2. Storage model and the Resend-compatible `POST /emails` (with tests using the real `resend`
   SDK pointed at the local server).
3. Dashboard: mailbox list → messages → message view, live updates.
4. MCP tools and the `wait` endpoint, with an end-to-end test for "send, then the agent extracts
   the code".
5. SMTP sink.
6. Access rules, container image, compiled binary.
