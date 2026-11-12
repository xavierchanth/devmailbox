# devmailbox: notes for agents

A dev mail sink with a unified inbox. [README.md](README.md) covers what it does and how to run
it; [docs/brief.md](docs/brief.md) records the original plan and the decisions made since.

## Commands

Use `just` (Bun underneath): `just test`, `just typecheck`, `just check` (typecheck, test and
build the dashboard, as CI does), `just dev`, `just dev-web`, `just build-web`, `just compile`.
Version control is jj (colocated with git); new bookmarks are `xc/<name>`.

## Layout

```
server/
  main.ts          CLI: serve | doctor
  app.ts           one HTTP server: routing by first path segment, Host and cross-site checks
  config.ts        JSON config + DEVMAILBOX_* overrides
  mail.ts          the service: ingest, events, wait, retention, ProviderScope
  store.ts         bun:sqlite schema and queries
  message.ts       the normalized message every way in produces
  query.ts         the search language: parse, SQL, in-memory match
  extract.ts       one-time codes and links
  html.ts          HTML → text
  api.ts           /api (zod + OpenAPI)
  mcp.ts           /mcp tools
  smtp.ts          the SMTP sink
  dashboard.ts     / : the built dashboard under a CSP, or a placeholder when it isn't built
  web-assets.ts    stub; scripts/compile.ts swaps in the dashboard files embedded in the binary
  providers/       provider emulations, one folder each, mounted at /<name>
web/               the dashboard (React, Vite, Tailwind v4)
  src/components/ui, src/lib/cn.ts, src/styles/olympus-theme.css
                   the Olympus UI kit, copied in shadcn style: project code, adjust as needed
  src/App.tsx      layout, search and live updates; state lives in the URL hash
  src/api.ts       typed /api client, sharing the server's types; SSE hook
scripts/compile.ts the single binary, dashboard embedded
skill/SKILL.md     the agent skill
service/           Containerfile, compose, systemd, launchd, example config
test/              end-to-end suites; fixtures/resend-openapi is Resend's spec (MIT)
```

## Rules that keep it working

- **Providers are sandboxed.** A provider gets a `ProviderScope` (mail.ts) and nothing else. It
  owns its whole wire format, its errors and its 404s, and never makes network calls. Adding one
  means a folder in `server/providers/` and an entry in `PROVIDERS`.
- **Match Resend from sources, not memory.** The docs, the OpenAPI spec in `test/fixtures` and
  the `resend` SDK source are the references. Error bodies are exactly
  `{statusCode, message, name}`, in that order, and every 2xx has a JSON body.
- **Queries run twice.** `toSql` (stored mail) and `matches` (live mail, for wait and SSE) must
  agree; `server/query.test.ts` runs every case through both. Add cases there when you change the
  language. Search columns are stored `fold()`ed.
- **Email content is untrusted.** HTML only leaves under the sandbox CSP in `api.ts`;
  attachments always download.
- **The dashboard follows the Olympus style** (the `design-style-olympus` skill): compact type,
  borders not shadows, color only for state and focus, kit components before raw elements. It
  imports the search language from `server/query.ts` rather than reimplementing it.
- **No auth, by design.** Don't add tokens or logins; the protection is where it listens, the Host
  check and the cross-site check.
- Tests start the real server on free ports with an in-memory database and drive it with real
  clients (`resend`, `nodemailer`, the MCP SDK). Keep it that way: no mocks of our own code.
