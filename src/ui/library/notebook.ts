import { api, type Annotation, type Book, type JournalEntry } from "../../api";
import { t } from "../../i18n";
import { h } from "../dom";
import { icon } from "../icons";
import { openMenuAt } from "../menu";
import { COLOR_NAMES, cssColor, labelChip, loadLabels, type ColorName, type Labels } from "../reader/annotations";
import { exportNotebook, type ExportData, type ExportFormat } from "../reader/export";
import { radios } from "../reader/settings-panel";

type Kind = "all" | "highlights" | "notes" | "journal";
type Order = "recent" | "book";

/** One row of the notebook: a highlight (with or without note) or a journal entry. */
type Entry =
  | { type: "note"; book: Book; at: number; item: Annotation }
  | { type: "journal"; book: Book; at: number; item: JournalEntry };

const percent = (p: number | null) => (p === null ? "" : `${Math.round(p * 100)}%`);
const dateTime = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" });
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Counts for the sidebar without rendering the view. */
export async function notebookCount(): Promise<number> {
  const [notes, journal] = await Promise.all([api.listAllAnnotations(), api.listAllJournal()]);
  return notes.length + journal.length;
}

/**
 * Library-wide view of every highlight, note and journal entry: searchable,
 * filterable by kind, meaning and book, and exportable.
 */
export function createNotebook(onOpen: (book: Book, jumpTo?: string) => void) {
  let entries: Entry[] = [];
  let labels: Labels | null = null;
  let query = "";
  let kind: Kind = "all";
  let color: ColorName | null = null;
  let bookId: number | null = null;
  let order: Order = "recent";

  const status = h("p", { class: "muted", role: "status" });
  const list = h("div", { class: "nb-list" });
  const controls = h("div", { class: "nb-controls" });
  const el = h("section", { class: "notebook", "aria-label": t("notebook") }, h("p", { class: "muted nb-intro" }, t("notebookIntro")), controls, status, list);

  const matches = (e: Entry) => {
    if (bookId !== null && e.book.id !== bookId) return false;
    if (kind === "journal" && e.type !== "journal") return false;
    if (kind === "highlights" && e.type !== "note") return false;
    if (kind === "notes" && !(e.type === "note" && e.item.note)) return false;
    if (color && !(e.type === "note" && e.item.color === color)) return false;
    if (!query) return true;
    const text =
      e.type === "note" ? `${e.item.text} ${e.item.note ?? ""}` : e.item.body;
    return `${text} ${e.book.title} ${e.book.author ?? ""}`.toLocaleLowerCase().includes(query);
  };

  const visible = () => {
    const shown = entries.filter(matches);
    if (order === "recent") return shown.sort((a, b) => b.at - a.at);
    return shown.sort(
      (a, b) =>
        collator.compare(a.book.title, b.book.title) ||
        a.book.id - b.book.id ||
        // Inside a book: highlights in reading order, then the journal by date.
        (a.type === b.type ? (a.type === "note" ? a.item.progress - (b.item as Annotation).progress : b.at - a.at) : a.type === "note" ? -1 : 1),
    );
  };

  const entryCard = (e: Entry, showBook: boolean) => {
    const target = e.item.location;
    const open = () => onOpen(e.book, target ?? undefined);
    const bookLine = showBook ? h("span", { class: "nb-book" }, e.book.title) : null;
    if (e.type === "note") {
      const a = e.item;
      return h(
        "article",
        { class: "nb-item", style: `--note-color:${cssColor(a.color)}` },
        h(
          "div",
          { class: "nb-meta" },
          labels ? labelChip(a.color, labels) : null,
          bookLine,
          h("span", { class: "muted" }, `${dateTime.format(new Date(a.createdAt * 1000))} · ${percent(a.progress)}`),
        ),
        h("blockquote", { class: "nb-quote" }, a.text),
        a.note ? h("p", { class: "note-text" }, icon("note"), h("span", {}, a.note)) : null,
        h("button", { class: "link-button", onclick: open }, icon("pin"), t("openInBook")),
      );
    }
    const j = e.item;
    return h(
      "article",
      { class: "nb-item nb-journal" },
      h(
        "div",
        { class: "nb-meta" },
        h("span", { class: "label-chip" }, icon("journal"), t("kindJournal")),
        bookLine,
        h("span", { class: "muted" }, `${dateTime.format(new Date(j.createdAt * 1000))}${j.progress !== null ? ` · ${percent(j.progress)}` : ""}`),
      ),
      h("p", { class: "journal-body" }, j.body),
      h("button", { class: "link-button", onclick: open }, icon("pin"), t("openInBook")),
    );
  };

  const drawList = () => {
    const shown = visible();
    status.textContent = t("nItems", String(shown.length));
    if (!entries.length) {
      list.replaceChildren(h("p", { class: "empty" }, t("notebookEmpty")));
      return;
    }
    if (!shown.length) {
      list.replaceChildren(h("p", { class: "empty" }, t("nothingFound")));
      return;
    }
    if (order === "recent") {
      list.replaceChildren(...shown.map((e) => entryCard(e, true)));
      return;
    }
    const groups = new Map<number, Entry[]>();
    for (const e of shown) groups.set(e.book.id, [...(groups.get(e.book.id) ?? []), e]);
    list.replaceChildren(
      ...[...groups.values()].map((group) =>
        h(
          "section",
          { class: "nb-group" },
          h(
            "h3",
            {},
            group[0].book.title,
            h("span", { class: "muted" }, ` · ${t("nItems", String(group.length))}`),
          ),
          ...group.map((e) => entryCard(e, false)),
        ),
      ),
    );
  };

  const runExport = async (format: ExportFormat) => {
    const shown = visible();
    if (!shown.length || !labels) return;
    const byBook = new Map<number, ExportData>();
    for (const e of shown) {
      const data = byBook.get(e.book.id) ?? { book: e.book, notes: [], journal: [], labels };
      if (e.type === "note") data.notes.push(e.item);
      else data.journal.push(e.item);
      byBook.set(e.book.id, data);
    }
    const groups = [...byBook.values()].sort((a, b) => collator.compare(a.book.title, b.book.title));
    groups.forEach((g) => g.notes.sort((a, b) => a.progress - b.progress));
    try {
      const path = await exportNotebook(groups, format);
      if (path) status.textContent = t("exported", path);
    } catch (err) {
      status.textContent = String(err);
    }
  };

  const drawControls = () => {
    const booksWithEntries = [...new Map(entries.map((e) => [e.book.id, e.book])).values()].sort((a, b) =>
      collator.compare(a.title, b.title),
    );
    const usedColors = COLOR_NAMES.filter((c) => entries.some((e) => e.type === "note" && e.item.color === c));
    const field = (label: string, control: Node) => h("div", { class: "nb-field" }, h("span", { class: "nb-field-label" }, label), control);

    const search = h("input", {
      type: "search",
      value: query,
      placeholder: t("searchNotebook"),
      "aria-label": t("searchNotebook"),
      oninput: (e: Event) => {
        query = (e.target as HTMLInputElement).value.trim().toLocaleLowerCase();
        drawList();
      },
    });
    const bookSelect = h(
      "select",
      {
        "aria-label": t("bookFilter"),
        onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          bookId = v ? Number(v) : null;
          drawList();
        },
      },
      h("option", { value: "" }, t("allBooks")),
      ...booksWithEntries.map((b) => h("option", { value: String(b.id), selected: b.id === bookId }, b.title)),
    );
    const meaningChips = h(
      "div",
      { class: "filter-chips", role: "group", "aria-label": t("meaning") },
      h("button", { class: "filter-chip", "aria-pressed": String(color === null), onclick: () => ((color = null), drawControls(), drawList()) }, t("allLabels")),
      ...usedColors.map((c) =>
        h(
          "button",
          { class: "filter-chip", "aria-pressed": String(color === c), onclick: () => ((color = c), drawControls(), drawList()) },
          labels ? labelChip(c, labels) : c,
        ),
      ),
    );

    controls.replaceChildren(
      h(
        "div",
        { class: "nb-row" },
        search,
        bookSelect,
        h(
          "button",
          {
            onclick: (e: Event) =>
              openMenuAt(e.currentTarget as HTMLElement, [
                { label: t("exportHtml"), action: () => runExport("html") },
                { label: t("exportMarkdown"), action: () => runExport("md") },
              ]),
          },
          `${t("exportShown")} ▾`,
        ),
      ),
      h(
        "div",
        { class: "nb-row" },
        field(
          t("show"),
          radios<Kind>(
            "nb-kind",
            [
              { value: "all", label: t("kindAll") },
              { value: "highlights", label: t("kindHighlights") },
              { value: "notes", label: t("kindNotes") },
              { value: "journal", label: t("kindJournal") },
            ],
            kind,
            (v) => {
              kind = v;
              if (v === "journal") color = null;
              drawControls();
              drawList();
            },
          ),
        ),
        field(
          t("orderBy"),
          radios<Order>(
            "nb-order",
            [
              { value: "recent", label: t("orderRecent") },
              { value: "book", label: t("orderBook") },
            ],
            order,
            (v) => {
              order = v;
              drawList();
            },
          ),
        ),
      ),
      kind !== "journal" && usedColors.length ? field(t("meaning"), meaningChips) : h("span", {}),
    );
  };

  return {
    el,
    /** Reloads everything; `books` maps entries to their (non-trashed) books. */
    async load(books: Book[]) {
      const byId = new Map(books.filter((b) => b.deletedAt === null).map((b) => [b.id, b]));
      const [notes, journal, loaded] = await Promise.all([api.listAllAnnotations(), api.listAllJournal(), loadLabels()]);
      labels = loaded;
      entries = [
        ...notes.flatMap((item) => (byId.has(item.bookId) ? [{ type: "note" as const, book: byId.get(item.bookId)!, at: item.createdAt, item }] : [])),
        ...journal.flatMap((item) => (byId.has(item.bookId) ? [{ type: "journal" as const, book: byId.get(item.bookId)!, at: item.createdAt, item }] : [])),
      ];
      if (bookId !== null && !byId.has(bookId)) bookId = null;
      drawControls();
      drawList();
    },
  };
}
