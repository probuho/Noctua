import { api, type Annotation, type Book } from "../api";
import { t } from "../i18n";
import { h } from "./dom";
import { icon } from "./icons";
import { openMenuAt } from "./menu";
import { COLOR_NAMES, cssColor, loadLabels, type ColorName, type Labels } from "./reader/annotations";
import { exportNotebook, type ExportData, type ExportFormat } from "./reader/export";
import { supportCard } from "./support-dialog";

type Order = "recent" | "book";
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const pct = (p: number) => `${Math.round(p * 100)} %`;

/** "Notas": every highlight and note of every book, from the design. */
export async function renderNotesPage(container: HTMLElement, onOpen: (book: Book, jumpTo?: string) => void): Promise<void> {
  const [notes, books, labels] = await Promise.all([api.listAllAnnotations(), api.listBooks(), loadLabels()]);
  const byId = new Map(books.filter((b) => b.deletedAt === null).map((b) => [b.id, b]));
  const all = notes.filter((n) => byId.has(n.bookId));
  let bookId: number | null = null;
  let color: ColorName | null = null;
  let query = "";
  let order: Order = "recent";
  let layout: "grid" | "list" = "grid";

  const counts = new Map<number, number>();
  for (const n of all) counts.set(n.bookId, (counts.get(n.bookId) ?? 0) + 1);
  const notedBooks = [...counts.keys()].map((id) => byId.get(id)!).sort((a, b) => collator.compare(a.title, b.title));

  const visible = () => {
    const q = query.trim().toLocaleLowerCase();
    const list = all.filter(
      (n) =>
        (bookId === null || n.bookId === bookId) &&
        (color === null || n.color === color) &&
        (!q || `${n.text} ${n.note ?? ""} ${byId.get(n.bookId)!.title}`.toLocaleLowerCase().includes(q)),
    );
    return order === "recent"
      ? list.sort((a, b) => b.createdAt - a.createdAt)
      : list.sort((a, b) => collator.compare(byId.get(a.bookId)!.title, byId.get(b.bookId)!.title) || a.progress - b.progress);
  };

  const side = h("aside", { class: "side-nav" });
  const list = h("div", { class: "note-cards" });
  const status = h("p", { class: "visually-hidden", role: "status" });
  const subtitle = h("p", { class: "muted" });

  const drawSide = () => {
    side.replaceChildren(
      h("div", { class: "side-head" }, h("h2", {}, t("navNotes")), h("p", {}, t("notesCount", String(all.length), String(notedBooks.length)))),
      h("p", { class: "side-label" }, t("byBook")),
      h(
        "ul",
        { class: "side-list" },
        h("li", {}, h("button", { type: "button", "aria-current": bookId === null ? "true" : undefined, onclick: () => ((bookId = null), draw()) }, h("span", {}, t("allBooks")), h("span", { class: "count" }, String(all.length)))),
        ...notedBooks.map((b) =>
          h("li", {}, h("button", { type: "button", "aria-current": bookId === b.id ? "true" : undefined, onclick: () => ((bookId = b.id), draw()) }, h("span", {}, b.title), h("span", { class: "count" }, String(counts.get(b.id))))),
        ),
      ),
      h("p", { class: "side-label" }, t("markerColor")),
      h(
        "div",
        { class: "color-filter", role: "radiogroup", "aria-label": t("markerColor") },
        ...COLOR_NAMES.map((c) =>
          h(
            "button",
            { type: "button", role: "radio", class: "color-dot", "aria-checked": String(color === c), "aria-label": labels[c], title: labels[c], onclick: () => ((color = color === c ? null : c), draw()) },
            h("span", { style: `background:${cssColor(c)}` }),
          ),
        ),
        h("button", { type: "button", role: "radio", class: "color-all", "aria-checked": String(color === null), onclick: () => ((color = null), draw()) }, t("allLabels")),
      ),
      h("div", { class: "side-bottom" }, supportCard()),
    );
  };

  const card = (n: Annotation) => {
    const book = byId.get(n.bookId)!;
    return h(
      "article",
      { class: "note-card", style: `--note-color:${cssColor(n.color)}` },
      h("p", { class: "nc-book" }, h("span", { class: "dot", style: `background:${cssColor(n.color)}` }), h("span", {}, book.title), h("span", { class: "nc-label" }, labels[n.color as ColorName] ?? "")),
      h("blockquote", { class: "nc-quote" }, n.text),
      n.note ? h("p", { class: "nc-note" }, n.note) : null,
      h(
        "div",
        { class: "nc-foot" },
        h("span", {}, pct(n.progress)),
        h("button", { type: "button", class: "btn-outline small", onclick: () => onOpen(book, n.location) }, icon("arrow-up-right"), h("span", {}, t("openInReader"))),
      ),
    );
  };

  const draw = () => {
    drawSide();
    const shown = visible();
    subtitle.textContent = t("notesCount", String(shown.length), String(new Set(shown.map((n) => n.bookId)).size));
    status.textContent = t("nItems", String(shown.length));
    list.dataset.layout = layout;
    list.replaceChildren(...(shown.length ? shown.map(card) : [h("p", { class: "empty" }, all.length ? t("nothingFound") : t("notebookEmpty"))]));
  };

  const runExport = async (format: ExportFormat) => {
    const groups = new Map<number, ExportData>();
    for (const n of visible()) {
      const g = groups.get(n.bookId) ?? { book: byId.get(n.bookId)!, notes: [], journal: [], labels: labels as Labels };
      g.notes.push(n);
      groups.set(n.bookId, g);
    }
    const path = await exportNotebook([...groups.values()], format);
    if (path) status.textContent = t("exported", path);
  };

  const search = h("input", {
    type: "search",
    placeholder: t("searchNotebook"),
    "aria-label": t("searchNotebook"),
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value;
      draw();
    },
  }) as HTMLInputElement;
  const sortBtn = h("button", { type: "button", class: "btn-outline" }, icon("arrow-down-up"), h("span", {}, t("orderRecent")));
  sortBtn.addEventListener("click", () =>
    openMenuAt(sortBtn, [
      { label: t("orderRecent"), action: () => ((order = "recent"), sortBtn.lastElementChild!.replaceChildren(t("orderRecent")), draw()) },
      { label: t("orderBook"), action: () => ((order = "book"), sortBtn.lastElementChild!.replaceChildren(t("orderBook")), draw()) },
    ]),
  );
  const layoutSwitch = viewToggle((l) => ((layout = l), draw()));

  container.replaceChildren(
    h(
      "div",
      { class: "page-with-side" },
      side,
      h(
        "main",
        { class: "page notes-page" },
        h(
          "header",
          { class: "page-head" },
          h("div", {}, h("h1", {}, t("notesTitle")), subtitle),
          h(
            "div",
            { class: "page-actions" },
            searchBox(search),
            sortBtn,
            layoutSwitch,
            h(
              "button",
              {
                type: "button",
                class: "btn-outline",
                onclick: (e: Event) =>
                  openMenuAt(e.currentTarget as HTMLElement, [
                    { label: t("exportHtml"), action: () => void runExport("html") },
                    { label: t("exportMarkdown"), action: () => void runExport("md") },
                  ]),
              },
              icon("download"),
              h("span", {}, t("export")),
            ),
          ),
        ),
        status,
        list,
      ),
    ),
  );
  draw();
  focusSearchOnCtrlF(search, container);
}

/** Search field with the "Ctrl F" hint from the design. */
export function searchBox(input: HTMLInputElement): HTMLElement {
  return h("label", { class: "search-field" }, icon("search"), input, h("kbd", { "aria-hidden": "true" }, "Ctrl F"));
}

/** Ctrl+F focuses the screen's search field while it is shown. */
export function focusSearchOnCtrlF(input: HTMLInputElement, scope: HTMLElement): void {
  const onKey = (e: KeyboardEvent) => {
    if (!scope.isConnected || !input.isConnected) return window.removeEventListener("keydown", onKey);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  };
  window.addEventListener("keydown", onKey);
}

/** Grid / list toggle from the design. */
export function viewToggle(onChange: (layout: "grid" | "list") => void, initial: "grid" | "list" = "grid"): HTMLElement {
  const group = h("div", { class: "view-toggle", role: "radiogroup", "aria-label": t("layout") });
  const draw = (value: "grid" | "list"): void => {
    group.replaceChildren(
      ...(["grid", "list"] as const).map((v) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": String(v === value),
            "aria-label": v === "grid" ? t("layoutGrid") : t("layoutList"),
            title: v === "grid" ? t("layoutGrid") : t("layoutList"),
            onclick: () => {
              draw(v);
              onChange(v);
            },
          },
          icon(v === "grid" ? "layout-grid" : "list"),
        ),
      ),
    );
  };
  draw(initial);
  return group;
}
