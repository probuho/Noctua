import { getCurrentWindow } from "@tauri-apps/api/window";

export async function isFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen();
}

export async function setFullscreen(on: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(on);
}

export async function toggleFullscreen(): Promise<boolean> {
  const next = !(await isFullscreen());
  await setFullscreen(next);
  return next;
}
