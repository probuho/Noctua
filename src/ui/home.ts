import { open } from "@tauri-apps/plugin-dialog";
import { api, type Book, type Category } from "../api";
import { t } from "../i18n";
import { loadSummary } from "../stats";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { formatDuration, importWithProgress } from "./import-progress";
import { getMode } from "./mode";
import type { Route } from "./shell";

export interface HomeDeps {
  go: (route: Route, libraryView?: string) => void;
  openBook: (book: Book, opts?: { panel?: "bookmarks" }) => void;
}

const relative = new Intl.RelativeTimeFormat(navigator.language, { numeric: "auto" });
function ago(seconds: number | null): string {
  if (!seconds) return "";
  const diff = seconds - Date.now() / 1000;
  const abs = Math.abs(diff);
  if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(diff / 3600), "hour");
  return relative.format(Math.round(diff / 86400), "day");
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** "Inicio": the welcome screen from the design, built from the real library. */
export async function renderHome(container: HTMLElement, deps: HomeDeps): Promise<void> {
  const [{ summary, books: all }, categories, formats] = await Promise.all([loadSummary(7), api.listCategories(), api.supportedFormats()]);
  const books = all.filter((b) => b.deletedAt === null);
  const recent = books.filter((b) => b.lastOpened).sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
  const current = recent.find((b) => b.progress < 0.995) ?? recent[0] ?? null;
  const active = books.filter((b) => b.progress > 0 && b.readAt === null).length;
  const timeLeft = (b: Book) =>
    summary.secondsPerBook && b.progress > 0.02 ? t("timeLeft", formatDuration(summary.secondsPerBook * (1 - b.progress))) : null;

  // --- Left column ------------------------------------------------------------
  const streak = h(
    "div",
    { class: "streak", role: "img", "aria-label": t("streakAria", String(summary.streak)) },
    h("div", { class: "streak-row" }, icon("flame"), h("strong", {}, summary.streak === 1 ? t("streakDay") : t("streakDays", String(summary.streak)))),
    h("div", { class: "streak-week" }, ...summary.week.map((read) => h("span", { class: read ? "on" : "" }))),
  );

  const formatSelect = h(
    "select",
    { "aria-label": t("format") },
    h("option", { value: "" }, t("anyFormat")),
    ...formats.filter((f) => books.some((b) => b.format === f.id)).map((f) => h("option", { value: f.id }, f.name)),
  ) as HTMLSelectElement;
  const categorySelect = h(
    "select",
    { "aria-label": t("category") },
    h("option", { value: "" }, t("anyCategory")),
    ...categories.map((c: Category) => h("option", { value: String(c.id) }, c.name)),
  ) as HTMLSelectElement;
  const picker = (iconName: IconName, label: string, select: HTMLSelectElement) =>
    h("label", { class: "cmd-field" }, icon(iconName), h("span", { class: "cmd-texts" }, h("span", { class: "cmd-label" }, label), h("span", { class: "cmd-value" }, select, icon("chevron-down"))));
  const commandBar = h(
    "form",
    {
      class: "command-bar",
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (categorySelect.value) deps.go("library", `category:${categorySelect.value}`);
        else if (formatSelect.value) deps.go("library", `format:${formatSelect.value}`);
        else deps.go("library", "all");
      },
    },
    picker("book-open", t("format").toUpperCase(), formatSelect),
    h("span", { class: "cmd-divider", "aria-hidden": "true" }),
    picker("tag", t("category").toUpperCase(), categorySelect),
    h("button", { type: "submit", class: "cmd-go" }, t("explore")),
  );

  const pill = (label: string, onclick: () => void) =>
    h("button", { type: "button", class: "pill-action", onclick }, h("span", { class: "pill-circle" }, icon("arrow-right")), h("span", {}, label));
  const openLocal = async () => {
    const picked = await open({ multiple: false, filters: [{ name: t("ebookFiles"), extensions: formats.flatMap((f) => f.extensions) }] });
    if (typeof picked !== "string") return;
    const result = await importWithProgress([picked], () => {});
    const book = result?.added[0] ?? (await api.listBooks()).find((b) => b.path === picked);
    if (book) deps.openBook(book);
  };

  const left = h(
    "div",
    { class: "hero-left" },
    streak,
    h("h1", { class: "hero-title" }, getMode() === "night" ? t("heroNight") : t("heroDay")),
    h("p", { class: "hero-sub" }, [active === 1 ? t("activeBook") : t("activeBooks", String(active)), summary.weekSeconds >= 60 ? t("readThisWeek", formatDuration(summary.weekSeconds)) : null].filter(Boolean).join(" • ")),
    commandBar,
    h(
      "div",
      { class: "quick-actions" },
      pill(t("openLocalFile"), () => void openLocal()),
      pill(t("seeBookmarks"), () => (current ? deps.openBook(current, { panel: "bookmarks" }) : deps.go("library"))),
    ),
  );

  // --- Right column: recent reads ----------------------------------------------
  const recentCards = recent.filter((b) => b !== current).slice(0, 2);
  const cards = (recentCards.length ? recentCards : recent.slice(0, 2)).map((b, i) =>
    h(
      "button",
      { type: "button", class: "recent-card", onclick: () => deps.openBook(b) },
      h("span", { class: `recent-icon tone-${i}` }, icon(b.format === "pdf" ? "file-text" : "bookmark")),
      h("span", { class: "recent-title" }, b.title),
      h("span", { class: "recent-meta" }, [`${b.format.toUpperCase()}`, t("percentDone", pct(b.progress)), ago(b.lastOpened)].filter(Boolean).join(" • ")),
    ),
  );
  const right = h(
    "div",
    { class: "hero-right" },
    h("div", { class: "recent-badge" }, h("span", {}, t("recentReads")), icon("clock-3")),
    h("div", { class: "recent-cards" }, ...(cards.length ? cards : [h("p", { class: "recent-empty" }, t("noRecentReads"))])),
  );

  // --- Bottom tray ----------------------------------------------------------------
  const resume = current
    ? h(
        "div",
        { class: "quick-resume" },
        current.cover ? h("img", { class: "qr-cover", src: current.cover, alt: "" }) : h("div", { class: "qr-cover placeholder" }, current.format.toUpperCase()),
        h(
          "div",
          { class: "qr-details" },
          h("span", { class: "qr-line" }, icon("library"), h("span", {}, current.title)),
          h("span", { class: "qr-line" }, icon("hourglass"), h("span", {}, [current.format.toUpperCase(), timeLeft(current)].filter(Boolean).join(" · "))),
          h(
            "span",
            { class: "qr-progress" },
            h("strong", {}, t("percentRead", pct(current.progress))),
            h("span", { class: "qr-bar", role: "progressbar", "aria-valuenow": Math.round(current.progress * 100), "aria-valuemin": 0, "aria-valuemax": 100 }, h("span", { style: `width:${(current.progress * 100).toFixed(1)}%` })),
          ),
        ),
        h("button", { type: "button", class: "qr-resume", onclick: () => deps.openBook(current) }, t("resume")),
      )
    : h("div", { class: "quick-resume empty-resume" }, h("p", {}, t("noBookYet")));

  const tile = (iconName: IconName, label: string, onclick: () => void) =>
    h("button", { type: "button", class: "collection-tile", onclick }, icon(iconName), h("span", {}, label));
  const collections = h(
    "section",
    { class: "collections-block", "aria-labelledby": "home-collections" },
    h("div", { class: "cb-head" }, h("h2", { id: "home-collections" }, t("navCollections").toUpperCase()), h("button", { type: "button", class: "cb-all", onclick: () => deps.go("collections") }, t("seeAll"))),
    h(
      "div",
      { class: "cb-tiles" },
      tile("book-text", "EPUB", () => deps.go("library", "format:epub")),
      tile("file-text", "PDF", () => deps.go("library", "format:pdf")),
      tile("star", t("favorites"), () => deps.go("library", "favorites")),
      tile("notebook-pen", t("markdownNotes"), () => deps.go("notes")),
    ),
  );

  container.replaceChildren(
    h(
      "main",
      { class: "home", "aria-label": t("navHome") },
      h("div", { class: "hero-art", "aria-hidden": "true" }),
      h("section", { class: "hero" }, left, right),
      h("div", { class: "tray" }, resume, collections),
    ),
  );
}
