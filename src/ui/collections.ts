import { api } from "../api";
import { t } from "../i18n";
import { promptDialog } from "./dialogs";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { categoryColor } from "./library/views";
import type { Route } from "./shell";

/** "Colecciones": every way the library is grouped, as large tiles. */
export async function renderCollections(container: HTMLElement, go: (route: Route, view?: string) => void): Promise<void> {
  const [books, categories, formats] = await Promise.all([api.listBooks(), api.listCategories(), api.supportedFormats()]);
  const live = books.filter((b) => b.deletedAt === null);
  const tile = (iconOrDot: IconName | string, label: string, count: number, view: string) =>
    h(
      "button",
      { type: "button", class: "collection-card", onclick: () => go("library", view) },
      iconOrDot.startsWith("#") ? h("span", { class: "dot", style: `background:${iconOrDot}` }) : icon(iconOrDot as IconName),
      h("span", { class: "cc-label" }, label),
      h("span", { class: "cc-count" }, t("nBooks", String(count))),
    );
  const section = (title: string, ...tiles: HTMLElement[]) =>
    h("section", { class: "cc-section" }, h("h2", {}, title), h("div", { class: "cc-grid" }, ...tiles));

  const usedFormats = formats.filter((f) => live.some((b) => b.format === f.id));
  container.replaceChildren(
    h(
      "main",
      { class: "page collections-page" },
      h("header", { class: "page-head" }, h("div", {}, h("h1", {}, t("navCollections")), h("p", { class: "muted" }, t("collectionsIntro")))),
      section(
        t("byStatus"),
        tile("history", t("recent"), live.filter((b) => b.lastOpened).length, "recent"),
        tile("star", t("favorites"), live.filter((b) => b.favorite).length, "favorites"),
        tile("circle-check", t("read"), live.filter((b) => b.readAt !== null).length, "read"),
        tile("inbox", t("uncategorized"), live.filter((b) => !b.categoryIds.length).length, "uncategorized"),
      ),
      section(t("formats"), ...usedFormats.map((f) => tile(f.id === "pdf" ? "file-text" : "book-text", f.name, live.filter((b) => b.format === f.id).length, `format:${f.id}`))),
      section(
        t("categories"),
        ...categories.map((c) => tile(categoryColor(c.id), c.name, live.filter((b) => b.categoryIds.includes(c.id)).length, `category:${c.id}`)),
        h(
          "button",
          {
            type: "button",
            class: "collection-card add",
            onclick: async () => {
              const name = await promptDialog(t("newCategory"));
              if (!name) return;
              await api.createCategory(name);
              await renderCollections(container, go);
            },
          },
          icon("plus"),
          h("span", { class: "cc-label" }, t("newCategory")),
        ),
      ),
    ),
  );
}
