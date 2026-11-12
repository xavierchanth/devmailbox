import { describe, expect, test } from "bun:test";
import { extractCodes, extractLinks } from "./extract.ts";
import { htmlToText } from "./html.ts";

type Fixture = { subject: string; html?: string; text?: string; variables?: Record<string, unknown> };
const msg = (f: Fixture) => ({
  subject: f.subject,
  html: f.html ?? null,
  text: f.text ?? null,
  providerData: f.variables ? { template: { id: "t", variables: f.variables } } : {},
});

const SUPABASE_VERIFY =
  "http://127.0.0.1:42001/auth/v1/verify?token=pkce_0f1e2d3c4b5a&amp;type=signup&amp;redirect_to=http://localhost:3000/welcome";

// [name, message, expected best code]
const CODES: Array<[string, Fixture, string | null]> = [
  [
    "styled OTP on its own line (Supabase {{ .Token }} template)",
    {
      subject: "Your app code",
      html: `<div style="max-width: 420px; padding: 32px 24px">
        <p style="font-size: 16px">Your code is</p>
        <p style="font-size: 32px; letter-spacing: 8px">\n    482913\n  </p>
        <p>Type it in the app to confirm your email. It expires in 1 hour.</p>
        <p style="font-size: 12px">© 2026 Example Inc, 100 Main St, Suite 2048</p></div>`,
    },
    "482913",
  ],
  [
    "react-email OTP with an order number and a year nearby",
    {
      subject: "Sign in to Acme",
      html: `<table><tr><td><h1>Sign in</h1><p>Order #5521 is ready. Use this verification code:</p>
        <p><strong>739 204</strong></p><p>Valid for 10 minutes. © 2026 Acme</p></td></tr></table>`,
    },
    "739204",
  ],
  [
    "code in the subject only",
    { subject: "123456 is your login code", text: "Hi! Someone asked to sign in. Ignore this if it wasn't you." },
    "123456",
  ],
  [
    "alphanumeric code",
    { subject: "Verify your email", text: "Your verification code: K7Q2ZP\n\nThanks, the team" },
    "K7Q2ZP",
  ],
  [
    "digits in URLs, emails and times are ignored",
    {
      subject: "Welcome",
      text: `Visit https://example.test/u/883421/profile or mail 445566@example.test at 10:30.\nYour code is 2468`,
    },
    "2468",
  ],
  [
    "Resend template variables",
    { subject: "(template otp)", text: "Resend template otp\n\nOTP_CODE: 905113\nNAME: Dev", variables: { OTP_CODE: 905113, NAME: "Dev" } },
    "905113",
  ],
  ["no code at all", { subject: "Your weekly digest", text: "Nothing new this week. See you in 2026." }, null],
];

describe("extractCodes", () => {
  for (const [name, f, expected] of CODES)
    test(name, () => {
      expect(extractCodes(msg(f))[0]?.value ?? null).toBe(expected);
    });

  test("candidates carry context", () => {
    const [best] = extractCodes(msg(CODES[0]![1]));
    expect(best!.context).toContain("Your code is");
  });
});

describe("extractLinks", () => {
  test("Supabase confirm link ranks first, entities decoded", () => {
    const links = extractLinks({
      text: null,
      html: `<h2>Confirm your signup</h2><p>Follow this link to confirm your user:</p>
        <p><a href="${SUPABASE_VERIFY}">Confirm your mail</a></p>
        <p><a href="https://example.test/">Example</a> · <a href="https://example.test/unsubscribe?u=1">Unsubscribe</a></p>`,
    });
    expect(links[0]).toMatchObject({
      url: "http://127.0.0.1:42001/auth/v1/verify?token=pkce_0f1e2d3c4b5a&type=signup&redirect_to=http://localhost:3000/welcome",
      text: "Confirm your mail",
      kind: "verification",
    });
    expect(links.find((l) => l.url.includes("unsubscribe"))!.kind).toBe("unsubscribe");
    expect(links.at(-1)!.kind).toBe("unsubscribe");
  });

  test("plain-text magic link, trailing punctuation trimmed", () => {
    const links = extractLinks({
      html: null,
      text: "Log in with this link: https://app.test/auth/magic?token=abc123.\nOr visit https://app.test.",
    });
    expect(links[0]).toMatchObject({ url: "https://app.test/auth/magic?token=abc123", kind: "verification" });
    expect(links.map((l) => l.url)).toContain("https://app.test");
  });

  test("mailto and relative links are skipped", () => {
    expect(extractLinks({ html: `<a href="mailto:a@b.test">x</a><a href="/x">y</a>`, text: null })).toEqual([]);
  });
});

describe("htmlToText", () => {
  test("blocks become lines, links keep their URL, styles and entities go", () => {
    expect(
      htmlToText(`<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;there &amp; welcome</p>
        <p><a href="https://x.test/a?b=1&amp;c=2">Open</a></p><br><table><tr><td>A</td><td>B</td></tr></table></body></html>`),
    ).toBe("Hi there & welcome\n\nOpen [https://x.test/a?b=1&c=2]\n\nA B");
  });
});
