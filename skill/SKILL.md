---
name: devmailbox
description: Read email sent by apps in a dev environment through devmailbox (MCP or HTTP) — wait for a sign-up, sign-in or reset email and take its one-time code or verification link. Use when a task needs to get through an email step of an auth flow, or to check what an app sent.
---

# devmailbox

devmailbox catches the email a dev environment sends: apps send through a Resend-compatible API
(`RESEND_BASE_URL=<devmailbox>/resend`) or SMTP, and nothing is delivered for real. You read it
through the MCP server at `<devmailbox>/mcp` (default `http://localhost:7430/mcp`), or `/api`.

Mail is sorted into **mailboxes** by the sender's API key (`re_slot3` → `slot3`) or SMTP username,
else `default`. You don't need the mailbox to find mail: search across all of them by recipient.

## Getting through an email step

1. **`mark_time`** before you trigger the email (submit the sign-up form, request the code).
2. Trigger it.
3. **`extract_code`** with `query: "to:<the address you used>"` and the `since` from step 1. It
   waits (default 30 s) for the email and returns the code. For a link, **`extract_links`**: the
   first `link` is the best verification / sign-in / reset link.
4. Use the code or open the link.

`wait_for_message` does the waiting and returns the whole email with its `code` and `link`, when
you want to read it too.

## Search

`query` works the same everywhere: `to:`, `from:`, `subject:`, `mailbox:`, `provider:`
(`resend`, `smtp`), `has:attachment`, `after:`, `before:` and bare words. A complete address
(`to:dev@align.test`) matches only that address; fragments (`to:@align.test`, `subject:confirm`)
match substrings. Repeating a key ORs, different keys AND: `to:dev@align.test subject:code`.

## Rules

- **Always scope by recipient** (`to:`) when you wait. The server may be shared by other
  workspaces and agents; an unscoped wait can return their email.
- **Use a fresh address per run when you can** (`dev+<task>@align.test`), so earlier emails can't
  match, and pass `since` from `mark_time` anyway.
- If no email arrives, check the app's logs and that it points at devmailbox
  (`RESEND_BASE_URL`, SMTP host and port) before retrying. `list_messages` shows what did arrive.
- `extract_code` returns other `candidates` with context. If the best one looks wrong, read them
  (or `get_message`) instead of guessing.
- Only `clear_mailbox` / `delete_message` mail you created.

## Over HTTP

```sh
curl "$DEVMAILBOX/api/wait?q=to:dev@align.test&timeout=30000"   # 200 with the message, or 408
curl "$DEVMAILBOX/api/messages/<id>/extract"                    # { code, link, codes, links }
```

`/api/info` lists the endpoints and the settings senders need; `/api/openapi.json` documents
the API.
