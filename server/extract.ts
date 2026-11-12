// Pull one-time codes and links out of a message, best first. Heuristics, tested against real
// templates (test/fixtures): a code is a 4–8 character token with digits, scored by the words
// around it; a link is scored by whether it looks like verification, sign-in or reset.

import { decodeEntities, htmlToText } from "./html.ts";
import type { Message } from "./message.ts";

export interface CodeCandidate {
  value: string;
  /** Where it was found: subject, body or a template variable. */
  source: "subject" | "body" | "template";
  /** The text around it, for a person or agent to judge. */
  context: string;
  score: number;
}

export interface LinkCandidate {
  url: string;
  text: string | null;
  kind: "verification" | "unsubscribe" | "other";
  score: number;
}

const KEYWORDS =
  /\b(code|otp|one[- ]time|passcode|pass code|verification|verify|confirm(ation)?|pin|token|log ?in|sign ?in|sign ?up|security|authenticat\w*|2fa|mfa)\b/i;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Codes inside URLs, emails and long numbers aren't codes. */
function maskNonCode(s: string): string {
  return s
    .replace(URL_RE, (m) => " ".repeat(m.length))
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => " ".repeat(m.length));
}

const CANDIDATE =
  /(?<![\w#$£€.:/-])(\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w%$:/]|\.\d|-\d)/g;

function scanCodes(
  text: string,
  source: CodeCandidate["source"],
): CodeCandidate[] {
  const masked = maskNonCode(text);
  const out: CodeCandidate[] = [];
  for (const m of masked.matchAll(CANDIDATE)) {
    const raw = m[1]!;
    const value = raw.replace(/[ -]/g, "");
    const at = m.index!;
    const before = text.slice(Math.max(0, at - 80), at);
    const after = text.slice(at + raw.length, at + raw.length + 40);
    let score = 0;
    if (KEYWORDS.test(before)) score += 4;
    else if (KEYWORDS.test(after)) score += 2;
    if (/^\d{6}$/.test(value)) score += 2;
    else if (/^\d+$/.test(value)) score += 1;
    // on a line of its own, as most templates show it
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = text.indexOf("\n", at + raw.length);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
    if (line === raw) score += 2;
    if (/^(19|20)\d{2}$/.test(value)) score -= 4; // years
    if (/(order|invoice|ticket|ref|no\.?|number|#)\s*$/i.test(before)) score -= 3;
    if (/(px|pt|em|%|am|pm)\b/i.test(after.slice(0, 3))) score -= 3;
    if (source === "subject") score += 1;
    if (source === "template") score += 1;
    out.push({
      value,
      source,
      context: `${before}${raw}${after}`.replace(/\s+/g, " ").trim(),
      score,
    });
  }
  return out;
}

export function extractCodes(m: Pick<Message, "subject" | "text" | "html" | "providerData">): CodeCandidate[] {
  const body = m.text ?? (m.html ? htmlToText(m.html) : "");
  const found = [...scanCodes(m.subject, "subject"), ...scanCodes(body, "body")];
  const template = (m.providerData as { template?: { variables?: Record<string, unknown> } })
    .template;
  for (const [k, v] of Object.entries(template?.variables ?? {})) {
    for (const c of scanCodes(String(v), "template")) {
      if (KEYWORDS.test(k)) c.score += 4;
      c.context = `${k}: ${String(v)}`;
      found.push(c);
    }
  }
  // the same value found twice (subject and body) counts once, at its best score plus a bit
  const best = new Map<string, CodeCandidate>();
  for (const c of found) {
    const prior = best.get(c.value);
    if (!prior) best.set(c.value, c);
    else {
      const top = prior.score >= c.score ? prior : c;
      best.set(c.value, { ...top, score: top.score + 1 });
    }
  }
  return [...best.values()]
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

const VERIFY =
  /verif|confirm|magic|token|otp|auth\/v1\/verify|reset|recover|invite|invitation|activate|sign[-_ ]?in|signin|log[-_ ]?in|login|callback|passwordless|accept/i;

export function extractLinks(m: Pick<Message, "text" | "html">): LinkCandidate[] {
  const found = new Map<string, LinkCandidate>();
  const add = (rawUrl: string, text: string | null) => {
    let url = decodeEntities(rawUrl.trim()).replace(/[).,;\]]+$/, "");
    if (/^www\./i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\//i.test(url)) return;
    const label = text?.replace(/\s+/g, " ").trim() || null;
    const kind: LinkCandidate["kind"] = /unsubscribe|opt[-_ ]?out|preferences/i.test(
      `${url} ${label ?? ""}`,
    )
      ? "unsubscribe"
      : VERIFY.test(url) || (label && VERIFY.test(label))
        ? "verification"
        : "other";
    const score =
      (kind === "verification" ? 10 : kind === "unsubscribe" ? -5 : 0) +
      (/[?&](token|code|token_hash)=/i.test(url) ? 3 : 0);
    const prior = found.get(url);
    if (!prior || (!prior.text && label))
      found.set(url, { url, text: label ?? prior?.text ?? null, kind, score });
  };
  if (m.html) {
    for (const a of m.html.matchAll(
      /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi,
    ))
      add(a[2]!, decodeEntities(a[3]!.replace(/<[^>]+>/g, "")));
  }
  const text = m.text ?? (m.html ? htmlToText(m.html) : "");
  for (const u of text.matchAll(URL_RE)) add(u[0], null);
  return [...found.values()].sort((a, b) => b.score - a.score);
}
