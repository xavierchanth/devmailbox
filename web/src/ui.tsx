// Small pieces shared across the dashboard: URL hash state, time and address formatting, copying.

import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip.tsx";

/** The dashboard's state lives in the hash (#q=…&m=…), so views can be bookmarked and shared. */
export interface Route {
  q: string;
  /** Selected message id. */
  m: string | null;
  page: "inbox" | "design-system";
}

export function readRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash === "design-system") return { q: "", m: null, page: "design-system" };
  const p = new URLSearchParams(hash);
  return { q: p.get("q") ?? "", m: p.get("m"), page: "inbox" };
}

export function writeRoute(r: Partial<Route>, replace = false) {
  const next = { ...readRoute(), ...r };
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.m) p.set("m", next.m);
  const hash = `#${p.toString()}`;
  if (replace) history.replaceState(null, "", hash || "#");
  else location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

/** "Name <a@b>" → "Name"; "a@b" → "a@b". */
export const displayName = (address: string) =>
  /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(address)?.[1] ?? address;

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** Re-render periodically so relative times stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The Clipboard API needs a secure context; plain http on a LAN name isn't one. */
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function CopyButton({
  value,
  label = "Copy",
  size = "icon-sm",
  children,
}: {
  value: string;
  label?: string;
  size?: "icon-sm" | "icon" | "sm" | "default";
  children?: ReactNode;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  const icon = done ? <Check /> : <Copy />;
  const button = (
    <Button
      variant={children ? "outline" : "ghost"}
      size={size}
      aria-label={label}
      onClick={() => void copyText(value).then(() => setDone(true))}
    >
      {icon}
      {children && (done ? "Copied" : children)}
    </Button>
  );
  if (children) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{done ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}
