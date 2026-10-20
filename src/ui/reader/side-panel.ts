import { api, type Annotation, type Book, type Bookmark, type JournalEntry } from "../../api";
import type { ReaderSession, ReadingPosition, SearchResult, TocItem } from "../../formats";
import { t } from "../../i18n";
import { confirmDialog } from "../dialogs";
import { h } from "../dom";
import { icon, type IconName } from "../icons";
import { openMenuAt } from "../menu";
import { COLOR_NAMES, cssColor, labelChip, type Annotator, type ColorName } from "./annotations";
import { exportNotes, type ExportFormat } from "./export";

export type PanelTab = "toc" | "search" | "bookmarks" | "notes" | "journal";

/** Order and look of the activity rail; the panel shows one of these at a time. */
export const PANEL_TABS: Array<{ id: PanelTab; label: Parameters<typeof t>[0]; icon: IconName }> = [
  { id: "toc", label: "contents", icon: "contents" },
  { id: "search", label: "search", icon: "search" },
  { id: "bookmarks", label: "bookmarks", icon: "bookmark" },
  { id: "notes", label: "notes", icon: "notes" },
  { id: "journal", label: "journal", icon: "journal" },
];

export const PANEL_ID = "reader-side-panel";
const MAX_RESULTS = 500;

interface Deps {
  book: Book;
  session: ReaderSession;
  annotator: Annotator | null;
  position: () => ReadingPosition | null;
}

function tocList(items: TocItem[], onPick: (target: string) => void): HTMLElement {
  return h(
    "ul",
    {},
    ...items.map((item) =>
      h(
        "li",
        {},
        h("button", { class: "list-item", onclick: () => onPick(item.target) }, item.label),
        item.children?.length ? tocList(item.children, onPick) : null,
      ),
    ),
  );
}

const percent = (progress: number) => `${Math.round(progress * 100)}%`;
const dateTime = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" });

/** Small icon-only action; the label is both tooltip and accessible name. */
const iconAction = (name: IconName, label: string, onclick: (e: Event) => void, extra = "") =>
  h("button", { class: `icon-action ${extra}`.trim(), title: label, "aria-label": label, onclick }, icon(name));

export function createSidePanel({ book, session, annotator, position }: Deps) {
  const bookId = book.id;
  let tab: PanelTab = "toc";
  let searchAbort: AbortController | null = null;
  const changeListeners: Array<(tab: PanelTab | null) => void> = [];

  const title = h("h2", { id: `${PANEL_ID}-title` });
  const body = h("div", { class: "panel-body" });
  const closeButton = iconAction("close", t("closePanel"), () => close());
  const el = h(
    "aside",
    { id: PANEL_ID, class: "side-panel", hidden: true, "aria-labelledby": `${PANEL_ID}-title` },
    h("header", { class: "panel-header" }, title, closeButton),
    body,
  );

  // --- Contents -----------------------------------------------------------
  const toc = session.toc();
  const tocView = toc.length
    ? tocList(toc, (target) => void session.goTo(target))
    : h("p", { class: "empty" }, t("noToc"));

  // --- Bookmarks ----------------------------------------------------------
  const bookmarkList = h("ul", { class: "bookmark-list" });
  const drawBookmarks = (marks: Bookmark[]) => {
    bookmarkList.replaceChildren(
      ...(marks.length
        ? marks.map((mark) =>
            h(
              "li",
              { class: "row-item" },
              h(
                "button",
                { class: "list-item", onclick: () => void session.goTo(mark.location) },
                h("span", {}, mark.label),
                h("span", { class: "muted" }, percent(mark.progress)),
              ),
              iconAction("trash", t("delete"), async () => drawBookmarks(await api.removeBookmark(mark.id, bookId))),
            ),
          )
        : [h("li", { class: "empty" }, t("noBookmarks"))]),
    );
  };
  const addBookmark = async () => {
    const pos = position();
    if (!pos) return;
    const label = pos.page ? `${t("page")} ${pos.page.current}` : (pos.label ?? percent(pos.progress));
    drawBookmarks(await api.addBookmark(bookId, pos.location, label, pos.progress));
  };
  const bookmarksView = h(
    "div",
    {},
    h(
      "div",
      { class: "panel-actions" },
      h("button", { class: "primary", onclick: () => void addBookmark() }, t("addBookmark")),
      h(
        "button",
        {
          onclick: async () => {
            if (!(await confirmDialog(t("confirmClearBookmarks")))) return;
            await api.clearBookmarks(bookId);
            drawBookmarks([]);
          },
        },
        t("clearBookmarks"),
      ),
    ),
    bookmarkList,
  );

  // --- Search -------------------------------------------------------------
  const searchInput = h("input", {
    type: "search",
    placeholder: session.capabilities.pages ? t("searchPlaceholder") : t("search"),
    "aria-label": t("search"),
  });
  const searchStatus = h("p", { class: "muted", role: "status" });
  const results = h("ul", { class: "search-results" });

  const runSearch = async (query: string) => {
    searchAbort?.abort();
    session.clearSearch();
    results.replaceChildren();
    searchStatus.textContent = "";
    query = query.trim();
    if (!query) return;

    const page = Number(query);
    if (session.capabilities.pages && Number.isInteger(page) && page > 0) {
      results.append(h("li", {}, h("button", { class: "list-item", onclick: () => void session.goTo(String(page)) }, t("goToPage", String(page)))));
    }

    const abort = (searchAbort = new AbortController());
    let count = 0;
    searchStatus.textContent = t("searching");
    const onResult = ({ target, section, excerpt }: SearchResult) => {
      if (++count > MAX_RESULTS) return abort.abort();
      results.append(
        h(
          "li",
          {},
          h(
            "button",
            { class: "list-item result", onclick: () => void session.goTo(target) },
            h("span", { class: "muted" }, section),
            h("span", {}, excerpt.pre, h("mark", {}, excerpt.match), excerpt.post),
          ),
        ),
      );
    };
    try {
      await session.search(query, onResult, abort.signal);
    } finally {
      if (searchAbort === abort) {
        searchStatus.textContent = count ? t("resultsCount", String(Math.min(count, MAX_RESULTS))) : t("nothingFound");
      }
    }
  };
  const searchView = h(
    "div",
    {},
    h(
      "form",
      {
        class: "panel-actions",
        role: "search",
        onsubmit: (e: Event) => {
          e.preventDefault();
          void runSearch(searchInput.value);
        },
      },
      searchInput,
      h("button", { type: "submit" }, t("search")),
    ),
    searchStatus,
    results,
  );

  // --- Notes --------------------------------------------------------------
  const notesStatus = h("p", { class: "muted", role: "status" });
  const notesList = h("ul", { class: "notes-list" });
  const labelFilter = h("div", { class: "filter-chips", role: "group", "aria-label": t("filterNotes") });
  let notesQuery = "";
  /** A color name, "note" for annotations with a note, or null for all. */
  let notesKind: ColorName | "note" | null = null;

  const drawFilter = (list: Annotation[]) => {
    const labels = annotator?.labels();
    const chip = (kind: typeof notesKind, content: Node | string, count: number) =>
      h(
        "button",
        {
          class: "filter-chip",
          "aria-pressed": String(notesKind === kind),
          onclick: () => {
            notesKind = kind;
            drawNotes(annotator?.list() ?? []);
          },
        },
        content,
        h("span", { class: "count" }, String(count)),
      );
    labelFilter.replaceChildren(
      chip(null, t("allLabels"), list.length),
      ...COLOR_NAMES.filter((c) => list.some((a) => a.color === c)).map((c) =>
        chip(c, labels ? labelChip(c, labels) : c, list.filter((a) => a.color === c).length),
      ),
      chip("note", t("withNote"), list.filter((a) => a.note).length),
    );
  };

  const drawNotes = (list: Annotation[]) => {
    drawFilter(list);
    const q = notesQuery.trim().toLocaleLowerCase();
    const shown = list.filter(
      (a) =>
        (notesKind === null || (notesKind === "note" ? Boolean(a.note) : a.color === notesKind)) &&
        (!q || `${a.text} ${a.note ?? ""}`.toLocaleLowerCase().includes(q)),
    );
    const labels = annotator?.labels();
    notesList.replaceChildren(
      ...(shown.length
        ? shown.map((a) =>
            h(
              "li",
              { class: "note-item row-item", style: `--note-color:${cssColor(a.color)}` },
              h(
                "button",
                { class: "list-item", onclick: () => void session.goTo(a.location) },
                h("span", { class: "note-meta" }, labels ? labelChip(a.color, labels) : null, h("span", { class: "muted" }, percent(a.progress))),
                h("span", { class: "note-quote" }, a.text),
                a.note ? h("span", { class: "note-text" }, icon("note"), h("span", {}, a.note)) : null,
              ),
              h(
                "div",
                { class: "row-actions" },
                iconAction("edit", a.note ? t("editNote") : t("addNote"), (e) => annotator?.editNote(a, e.currentTarget as HTMLElement)),
                iconAction("trash", t("deleteHighlight"), () => void annotator?.remove(a)),
              ),
            ),
          )
        : [h("li", { class: "empty" }, list.length ? t("nothingFound") : t("noNotes"))]),
    );
  };

  // --- Journal ------------------------------------------------------------
  let journal: JournalEntry[] = [];
  const journalList = h("ul", { class: "journal-list" });
  const journalInput = h("textarea", { rows: 4, placeholder: t("journalPlaceholder"), "aria-label": t("journal") });
  const linkInput = h("input", { type: "checkbox", checked: true });

  const drawJournal = () => {
    journalList.replaceChildren(
      ...(journal.length
        ? journal.map((entry) => {
            const bodyEl = h("p", { class: "journal-body" }, entry.body);
            const li = h(
              "li",
              { class: "journal-entry" },
              h(
                "div",
                { class: "journal-meta" },
                h(
                  "time",
                  { datetime: new Date(entry.createdAt * 1000).toISOString() },
                  dateTime.format(new Date(entry.createdAt * 1000)),
                  entry.updatedAt > entry.createdAt + 59 ? ` · ${t("edited")}` : "",
                ),
                h(
                  "div",
                  { class: "row-actions" },
                  iconAction("edit", t("editEntry"), () => editEntry(entry, li, bodyEl)),
                  iconAction("trash", t("deleteEntry"), async () => {
                    if (!(await confirmDialog(t("confirmDeleteEntry")))) return;
                    journal = await api.deleteJournalEntry(entry.id, bookId);
                    drawJournal();
                  }),
                ),
              ),
              bodyEl,
              entry.location !== null
                ? h(
                    "button",
                    { class: "link-button", onclick: () => void session.goTo(entry.location!) },
                    icon("pin"),
                    t("goToPosition", percent(entry.progress ?? 0)),
                  )
                : null,
            );
            return li;
          })
        : [h("li", { class: "empty" }, t("noJournal"))]),
    );
  };

  const editEntry = (entry: JournalEntry, li: HTMLElement, bodyEl: HTMLElement) => {
    const editor = h("textarea", { rows: 4, "aria-label": t("editEntry") });
    editor.value = entry.body;
    const form = h(
      "form",
      {
        class: "journal-edit",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (!editor.value.trim()) return;
          journal = await api.updateJournalEntry(entry.id, bookId, editor.value);
          drawJournal();
        },
      },
      editor,
      h(
        "div",
        { class: "modal-actions" },
        h("button", { type: "button", onclick: () => drawJournal() }, t("cancel")),
        h("button", { type: "submit", class: "primary" }, t("save")),
      ),
    );
    bodyEl.replaceWith(form);
    li.querySelector(".link-button")?.remove();
    editor.focus();
  };

  const journalView = h(
    "div",
    {},
    h(
      "form",
      {
        class: "journal-form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const text = journalInput.value.trim();
          if (!text) return journalInput.focus();
          const pos = linkInput.checked ? position() : null;
          journal = await api.addJournalEntry(bookId, text, pos?.location ?? null, pos?.progress ?? null);
          journalInput.value = "";
          drawJournal();
        },
      },
      journalInput,
      h("label", { class: "check-row" }, linkInput, t("linkPosition")),
      h("button", { type: "submit", class: "primary" }, t("addEntry")),
    ),
    journalList,
  );

  // --- Export (notes + journal) -------------------------------------------
  const runExport = async (format: ExportFormat) => {
    const notes = annotator?.list() ?? [];
    if (!notes.length && !journal.length) return;
    try {
      const path = await exportNotes({ book, notes, journal, labels: annotator!.labels() }, format);
      if (path) notesStatus.textContent = t("exported", path);
    } catch (err) {
      notesStatus.textContent = String(err);
    }
  };
  const exportButton = h(
    "button",
    {
      onclick: (e: Event) =>
        openMenuAt(e.currentTarget as HTMLElement, [
          { label: t("exportHtml"), action: () => runExport("html") },
          { label: t("exportMarkdown"), action: () => runExport("md") },
        ]),
    },
    `${t("exportNotes")} ▾`,
  );

  const notesView = h(
    "div",
    {},
    h(
      "div",
      { class: "panel-actions" },
      h("input", {
        type: "search",
        placeholder: t("filterNotes"),
        "aria-label": t("filterNotes"),
        oninput: (e: Event) => {
          notesQuery = (e.target as HTMLInputElement).value;
          drawNotes(annotator?.list() ?? []);
        },
      }),
      exportButton,
      iconAction(
        "trash",
        t("clearNotes"),
        async () => {
          if (annotator?.list().length && (await confirmDialog(t("confirmClearNotes")))) await annotator.clear();
        },
        "danger",
      ),
    ),
    labelFilter,
    notesStatus,
    notesList,
  );
  annotator?.onChange(drawNotes);
  drawNotes([]);

  // --- Panel state --------------------------------------------------------
  const views: Partial<Record<PanelTab, HTMLElement>> = {
    toc: tocView,
    search: searchView,
    bookmarks: bookmarksView,
    ...(annotator ? { notes: notesView, journal: journalView } : { journal: journalView }),
  };

  // Search highlights only make sense while the results are visible.
  const leaveSearch = () => {
    searchAbort?.abort();
    session.clearSearch();
  };

  const firstFocusable: Record<PanelTab, () => HTMLElement | null> = {
    toc: () => body.querySelector("button"),
    search: () => searchInput,
    bookmarks: () => body.querySelector("button"),
    notes: () => body.querySelector("input"),
    journal: () => journalInput,
  };

  const emit = () => changeListeners.forEach((l) => l(el.hidden ? null : tab));

  function open(next: PanelTab) {
    if (!views[next]) return;
    if (tab === "search" && next !== "search") leaveSearch();
    tab = next;
    title.textContent = t(PANEL_TABS.find((x) => x.id === next)!.label);
    body.replaceChildren(views[next]!);
    el.hidden = false;
    emit();
    firstFocusable[next]()?.focus();
  }

  function close() {
    if (el.hidden) return;
    if (tab === "search") leaveSearch();
    el.hidden = true;
    emit();
  }

  void api.listBookmarks(bookId).then(drawBookmarks);
  void api.listJournal(bookId).then((list) => {
    journal = list;
    drawJournal();
  });

  return {
    el,
    has: (next: PanelTab) => Boolean(views[next]),
    isOpen: () => !el.hidden,
    current: () => (el.hidden ? null : tab),
    onChange: (l: (tab: PanelTab | null) => void) => void changeListeners.push(l),
    open,
    toggle(next: PanelTab) {
      if (!el.hidden && tab === next) close();
      else open(next);
    },
    close,
    /** Opens search and runs a query (used from the selection popup). */
    search(query: string) {
      open("search");
      searchInput.value = query;
      void runSearch(query);
    },
    addBookmark,
    destroy() {
      searchAbort?.abort();
    },
  };
}
