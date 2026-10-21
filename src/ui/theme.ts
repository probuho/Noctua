import type { ReaderSettings, Theme } from "../formats/types";

export const THEMES: Theme[] = ["light", "sepia", "dark", "night-sepia"];

export const THEME_COLORS: Record<Theme, { bg: string; fg: string; link: string }> = {
  light: { bg: "#ffffff", fg: "#1f1f1f", link: "#1a5fb4" },
  sepia: { bg: "#f4ecd8", fg: "#5b4636", link: "#8a4b08" },
  // Night page from the design: the app surface with warm off-white text.
  dark: { bg: "#161f2c", fg: "#e8e6e1", link: "#e5a93c" },
  "night-sepia": { bg: "#2a2118", fg: "#d9c7a7", link: "#e0a96d" },
};

export const FONT_STACKS = {
  serif: '"Literata Variable", Literata, Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const;

const KEY = "reader-settings";

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "light",
  fontSize: 100,
  fontFamily: "original",
  lineHeight: 1.5,
  textAlign: "original",
  layout: "double",
  pdfFit: "page",
  dimming: 0,
  autoFlipSeconds: 30,
};

export function loadSettings(): ReaderSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable; settings then last for this session only.
  }
}

export function applyAppTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
