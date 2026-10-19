import { getCurrentWindow } from "@tauri-apps/api/window";

// Outside Tauri (e.g. the dev harness) fall back to the browser API.
const inTauri = "__TAURI_INTERNALS__" in window;

export async function isFullscreen(): Promise<boolean> {
  return inTauri ? getCurrentWindow().isFullscreen() : Boolean(document.fullscreenElement);
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (inTauri) return getCurrentWindow().setFullscreen(on);
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}

export async function toggleFullscreen(): Promise<boolean> {
  const next = !(await isFullscreen());
  await setFullscreen(next);
  return next;
}
