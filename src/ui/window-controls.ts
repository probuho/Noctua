import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../i18n";
import { h } from "./dom";
import { icon } from "./icons";

/**
 * Minimize / maximize-restore / close for the frameless window (the design
 * draws its own title bar). The window can still be snapped (drag to an edge,
 * Win+arrows, Win+Z), resized from its borders and maximized by
 * double-clicking any empty part of the bar.
 */
export function windowControls(): HTMLElement {
  const win = getCurrentWindow();
  const max = h("button", { type: "button", class: "win-btn" });
  const drawMax = (maximized: boolean) => {
    const label = maximized ? t("winRestore") : t("winMaximize");
    max.replaceChildren(icon(maximized ? "copy" : "square"));
    max.setAttribute("aria-label", label);
    max.title = label;
  };
  drawMax(false);
  const sync = () => void win.isMaximized().then(drawMax).catch(() => {});
  sync();
  // Keep the icon right when the window is snapped or maximized by other means.
  void win.onResized(sync);
  max.addEventListener("click", () => void win.toggleMaximize().then(sync));

  return h(
    "div",
    { class: "win-controls" },
    h("button", { type: "button", class: "win-btn", "aria-label": t("winMinimize"), title: t("winMinimize"), onclick: () => void win.minimize() }, icon("minus")),
    max,
    h("button", { type: "button", class: "win-btn win-close", "aria-label": t("winClose"), title: t("winClose"), onclick: () => void win.close() }, icon("x")),
  );
}

/** Marks `el` (and only `el`, not its children) as a handle to move the window. */
export function dragRegion<T extends HTMLElement>(el: T): T {
  el.setAttribute("data-tauri-drag-region", "");
  return el;
}
