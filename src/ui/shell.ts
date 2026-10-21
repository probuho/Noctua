import { t } from "../i18n";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { getMode, onModeChange, setMode, type Mode } from "./mode";
import { openAppSettings } from "./app-settings";
import { dragRegion, windowControls } from "./window-controls";

/** Top-level screens reachable from the global navigation. */
export type Route = "home" | "library" | "collections" | "notes" | "stats";

const NAV: Array<{ route: Route; label: Parameters<typeof t>[0]; icon: IconName }> = [
  { route: "home", label: "navHome", icon: "house" },
  { route: "library", label: "navLibrary", icon: "library" },
  { route: "collections", label: "navCollections", icon: "layers" },
  { route: "notes", label: "navNotes", icon: "notebook-pen" },
  { route: "stats", label: "navStats", icon: "chart-column" },
];

/** Brand mark used in the bars: book icon tile + "Noctua". */
export function brand(): HTMLElement {
  return dragRegion(
    h("div", { class: "brand" }, dragRegion(h("span", { class: "brand-logo", "aria-hidden": "true" }, icon("book-open"))), dragRegion(h("span", { class: "brand-name" }, "Noctua"))),
  );
}

/** Night / day segmented switch. */
export function modeSwitch(): HTMLElement {
  const group = h("div", { class: "mode-switch", role: "radiogroup", "aria-label": t("appearance") });
  const draw = (mode: Mode) =>
    group.replaceChildren(
      ...(["night", "day"] as Mode[]).map((m) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": String(m === mode),
            "aria-label": m === "night" ? t("modeNight") : t("modeDay"),
            title: m === "night" ? t("modeNight") : t("modeDay"),
            onclick: () => setMode(m),
          },
          icon(m === "night" ? "moon" : "sun"),
        ),
      ),
    );
  draw(getMode());
  const off = onModeChange(draw);
  new MutationObserver((_, obs) => {
    if (!group.isConnected) {
      off();
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });
  return group;
}

/**
 * The app frame from the design ("Topbar · Layout B"): brand, global
 * navigation, night/day switch, settings and the window controls, above the
 * current screen. Empty parts of the bar move the window; double-click maximizes.
 */
export function renderShell(root: HTMLElement, route: Route, go: (route: Route) => void): HTMLElement {
  const nav = h(
    "nav",
    { class: "global-nav", "aria-label": t("mainNavigation") },
    ...NAV.map((item) =>
      h(
        "button",
        {
          type: "button",
          class: "nav-item",
          "aria-current": item.route === route ? "page" : undefined,
          title: t(item.label),
          onclick: () => item.route !== route && go(item.route),
        },
        icon(item.icon),
        h("span", { class: "nav-label" }, t(item.label)),
      ),
    ),
  );
  const topbar = dragRegion(
    h(
      "header",
      { class: "topbar" },
      brand(),
      nav,
      dragRegion(
        h(
          "div",
          { class: "topbar-actions" },
          modeSwitch(),
          h("button", { type: "button", class: "icon-btn", "aria-label": t("appSettings"), title: t("appSettings"), onclick: () => openAppSettings() }, icon("settings")),
          h("span", { class: "topbar-sep", "aria-hidden": "true" }),
          windowControls(),
        ),
      ),
    ),
  );
  const content = h("div", { class: "shell-content" });
  root.replaceChildren(h("div", { class: "shell" }, topbar, content));
  return content;
}
