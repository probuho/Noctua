import { loadSettings, saveSettings } from "./theme";

/** App appearance from the design: "night" (default) or "day". */
export type Mode = "night" | "day";

const KEY = "app-mode";
const listeners: Array<(mode: Mode) => void> = [];

export function getMode(): Mode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "night" || saved === "day") return saved;
  } catch {
    /* storage unavailable */
  }
  return "night";
}

export function applyMode(mode: Mode = getMode()): void {
  document.documentElement.dataset.mode = mode;
}

/**
 * Switches the app between night and day. The book pages follow: night uses
 * the dark page theme and day the light one, unless the reader picked one of
 * the sepia themes for that brightness.
 */
export function setMode(mode: Mode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* lasts for this session only */
  }
  const settings = loadSettings();
  const dark = settings.theme === "dark" || settings.theme === "night-sepia";
  if (mode === "night" && !dark) settings.theme = "dark";
  if (mode === "day" && dark) settings.theme = "light";
  saveSettings(settings);
  document.documentElement.dataset.theme = settings.theme;
  applyMode(mode);
  listeners.forEach((l) => l(mode));
}

export function onModeChange(listener: (mode: Mode) => void): () => void {
  listeners.push(listener);
  return () => listeners.splice(listeners.indexOf(listener), 1);
}
