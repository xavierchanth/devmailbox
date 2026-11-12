// Light, dark or the system's choice, kept per browser. "auto" removes data-theme so the theme
// follows prefers-color-scheme.

export type Appearance = "auto" | "light" | "dark";

const KEY = "devmailbox.appearance";

export function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyAppearance(a: Appearance) {
  if (a === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = a;
}

export function saveAppearance(a: Appearance) {
  applyAppearance(a);
  try {
    if (a === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, a);
  } catch {}
}
