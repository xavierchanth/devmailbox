// Small HTML helpers for email bodies: plain text for search, snippets and extraction, and the
// text part Resend generates when a sender gives only HTML. Not a sanitizer; HTML is only ever
// served under a sandbox CSP (see api.ts).

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  zwnj: "",
  zwj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Readable text from an email's HTML: block elements become line breaks, links keep their URL. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    // keep a link's target next to its text, as Resend's generated text does
    .replace(
      /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_m, _q, href: string, inner: string) => {
        const label = inner.replace(/<[^>]+>/g, "").trim();
        const url = decodeEntities(href.trim());
        if (!label || decodeEntities(label) === url) return url;
        return /^(https?:|mailto:)/i.test(url) ? `${inner} [${url}]` : inner;
      },
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/?(p|div|tr|table|tbody|thead|h[1-6]|li|ul|ol|blockquote|section|header|footer|center|hr)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function snippet(text: string, max = 160): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
