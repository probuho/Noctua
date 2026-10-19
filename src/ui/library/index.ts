import { open } from "@tauri-apps/plugin-dialog";
import { api, loadBookFile, type AddResult, type Book, type Category, type FormatInfo } from "../../api";
import { getFormat } from "../../formats";
import { t } from "../../i18n";
import { confirmDialog, promptDialog, alertDialog } from "../dialogs";
import { blobToThumbnail, h } from "../dom";
import { openMenu, openMenuAt, type MenuItem } from "../menu";
import { openProperties } from "./properties";
import {
  booksInView,
  continueCandidate,
  matchesQuery,
  parseViewKey,
  sameView,
  SORT_KEYS,
  sortBooks,
  viewKey,
  type SortKey,
  type View,
} from "./views";

const VIEW_KEY = "library-view";
const SORT_KEY = "library-sort";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Per-viewer convenience only.
  }
}

/** Reads title, author and cover through the format plugin and stores them. */
async function enrichMetadata(book: Book): Promise<void> {
  try {
    const meta = await getFormat(book.format).extractMetadata(await loadBookFile(book));
    const cover = meta.cover ? await blobToThumbnail(meta.cover) : undefined;
    await api.setExtractedMetadata(book.id, { title: meta.title, author: meta.author, cover });
  } catch (err) {
    console.warn(`Metadata extraction failed for ${book.path}`, err);
  }
}

/** Listens for files dropped on the window. Returns an unsubscribe function. */
async function onFilesDropped(onHover: (over: boolean) => void, onDrop: (paths: string[]) => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window) || "__HARNESS__" in window) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter" || payload.type === "over") onHover(true);
    else if (payload.type === "leave") onHover(false);
    else if (payload.type === "drop") {
      onHover(false);
      if (payload.paths.length) onDrop(payload.paths);
    }
  });
}

export async function renderLibrary(root: HTMLElement, onOpen: (book: Book) => void): Promise<void> {
  const formats: FormatInfo[] = await api.supportedFormats();
  let books: Book[] = [];
  let categories: Category[] = [];
  let view: View = parseViewKey(stored(VIEW_KEY));
  let sort: SortKey = (SORT_KEYS as string[]).includes(stored(SORT_KEY) ?? "") ? (stored(SORT_KEY) as SortKey) : "recent";
  let query = "";
  let selecting = false;
  let lastClicked: number | null = null;
  const selected = new Set<number>();

  const sidebar = h("nav", { class: "sidebar", "aria-label": t("categories") });
  const banner = h("div", { class: "continue" });
  const status = h("p", { class: "status", role: "status" });
  const viewHeader = h("div", { class: "view-header" });
  const grid = h("section", { class: "book-grid" });
  const selectionBar = h("footer", { class: "selection-bar", hidden: true });
  const dropOverlay = h("div", { class: "drop-overlay", hidden: true }, h("p", {}, t("dropHere")));

  const visible = () => sortBooks(booksInView(books, view), sort).filter((b) => matchesQuery(b, query));
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? "?";

  const viewLabel = (v: View): string => {
    switch (v.kind) {
      case "category":
        return categoryName(v.id);
      case "format":
        return formats.find((f) => f.id === v.id)?.name ?? v.id.toUpperCase();
      default:
        return t(v.kind);
    }
  };

  const refresh = async () => {
    [books, categories] = await Promise.all([api.listBooks(), api.listCategories()]);
    // Drop selections of books that left the current view.
    const ids = new Set(booksInView(books, view).map((b) => b.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    const current = view;
    if (current.kind === "category" && !categories.some((c) => c.id === current.id)) setView({ kind: "all" });
    draw();
  };

  const setView = (next: View) => {
    view = next;
    store(VIEW_KEY, viewKey(view));
    selected.clear();
    draw();
  };

  // --- Actions ---------------------------------------------------------------------

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      await alertDialog(String(err));
    }
    await refresh();
  };

  const addPaths = async (paths: string[]) => {
    let result: AddResult;
    try {
      result = await api.addBooks(paths);
    } catch (err) {
      return alertDialog(String(err));
    }
    const notes = [t("booksAdded", String(result.added.length))];
    if (result.duplicates.length) notes.push(t("duplicates", String(result.duplicates.length)));
    if (result.unsupported.length) notes.push(t("unsupported", result.unsupported.join(", ")));
    status.textContent = notes.join(" · ");
    await refresh();
    for (const [i, book] of result.added.entries()) {
      status.textContent = `${notes.join(" · ")} · ${i + 1}/${result.added.length}`;
      await enrichMetadata(book);
    }
    if (result.added.length) {
      status.textContent = notes.join(" · ");
      await refresh();
    }
  };

  const pickFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: t("ebookFiles"), extensions: formats.flatMap((f) => f.extensions) }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) await addPaths(paths);
  };

  const pickFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") await addPaths([picked]);
  };

  const newCategory = async (thenAdd?: number[]) => {
    const name = await promptDialog(t("newCategory"));
    if (!name) return;
    await run(async () => {
      const category = await api.createCategory(name);
      if (thenAdd?.length) await api.addToCategory(thenAdd, category.id);
    });
  };

  /** Menu entries that apply to a set of books (one card or the selection). */
  const bookActions = (targets: Book[]): MenuItem[] => {
    const ids = targets.map((b) => b.id);
    if (targets.every((b) => b.deletedAt !== null)) {
      return [
        { label: t("restore"), action: () => run(() => api.restoreBooks(ids)) },
        {
          label: t("deletePermanently"),
          danger: true,
          action: async () => {
            if (await confirmDialog(t("confirmDelete", String(ids.length)))) await run(() => api.deleteBooks(ids));
          },
        },
      ];
    }
    const allFavorite = targets.every((b) => b.favorite);
    const allRead = targets.every((b) => b.readAt !== null);
    const items: MenuItem[] = [
      {
        label: t("addToCategory"),
        submenu: [
          ...categories.map((c) => ({ label: c.name, action: () => run(() => api.addToCategory(ids, c.id)) })),
          ...(categories.length ? (["separator"] as MenuItem[]) : []),
          { label: `+ ${t("newCategory")}`, action: () => newCategory(ids) },
        ],
      },
    ];
    if (view.kind === "category") {
      const id = view.id;
      items.push({ label: t("removeFromCategory", categoryName(id)), action: () => run(() => api.removeFromCategory(ids, id)) });
    }
    items.push(
      {
        label: allFavorite ? t("removeFavorite") : t("addFavorite"),
        action: () => run(() => api.setFavorite(ids, !allFavorite)),
      },
      { label: allRead ? t("markUnread") : t("markRead"), action: () => run(() => api.setRead(ids, !allRead)) },
      "separator",
      { label: t("moveToTrash"), danger: true, action: () => run(() => api.trashBooks(ids)) },
    );
    return items;
  };

  const cardMenu = (book: Book): MenuItem[] => {
    if (book.deletedAt !== null) return bookActions([book]);
    return [
      { label: t("open"), action: () => onOpen(book) },
      {
        label: `${t("properties")}…`,
        action: async () => {
          await openProperties(book);
          await refresh();
        },
      },
      "separator",
      ...bookActions([book]),
    ];
  };

  // --- Selection -------------------------------------------------------------------

  const toggleSelected = (book: Book, e: MouseEvent) => {
    const list = visible();
    if (e.shiftKey && lastClicked !== null) {
      const a = list.findIndex((b) => b.id === lastClicked);
      const b = list.findIndex((x) => x.id === book.id);
      for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(x.id);
    } else if (selected.has(book.id)) {
      selected.delete(book.id);
    } else {
      selected.add(book.id);
    }
    lastClicked = book.id;
    draw();
  };

  // --- Rendering -------------------------------------------------------------------

  const sidebarItem = (v: View, label: string, count: number, extra?: HTMLElement) =>
    h(
      "li",
      { class: "sidebar-item" },
      h(
        "button",
        { "aria-current": sameView(v, view) ? "page" : undefined, onclick: () => setView(v) },
        h("span", { class: "label" }, label),
        h("span", { class: "count" }, String(count)),
      ),
      extra,
    );

  const drawSidebar = () => {
    const count = (v: View) => booksInView(books, v).length;
    const usedFormats = formats.filter((f) => books.some((b) => b.format === f.id && b.deletedAt === null));
    sidebar.replaceChildren(
      h(
        "ul",
        {},
        ...(["all", "recent", "favorites", "read", "uncategorized"] as const).map((kind) =>
          sidebarItem({ kind }, t(kind), count({ kind })),
        ),
      ),
      h(
        "div",
        { class: "sidebar-heading" },
        h("span", {}, t("categories")),
        h("button", { class: "icon", title: t("newCategory"), "aria-label": t("newCategory"), onclick: () => newCategory() }, "+"),
      ),
      h(
        "ul",
        {},
        ...categories.map((c) =>
          sidebarItem(
            { kind: "category", id: c.id },
            c.name,
            count({ kind: "category", id: c.id }),
            h(
              "button",
              {
                class: "icon item-menu",
                "aria-label": `${c.name}: ${t("rename")} / ${t("delete")}`,
                onclick: (e: Event) =>
                  openMenuAt(e.currentTarget as HTMLElement, [
                    {
                      label: t("rename"),
                      action: async () => {
                        const name = await promptDialog(t("categoryName"), c.name);
                        if (name) await run(() => api.renameCategory(c.id, name));
                      },
                    },
                    {
                      label: t("delete"),
                      danger: true,
                      action: async () => {
                        if (await confirmDialog(t("confirmDeleteCategory", c.name))) await run(() => api.deleteCategory(c.id));
                      },
                    },
                  ]),
              },
              "⋯",
            ),
          ),
        ),
      ),
      // Formats only help once the library mixes more than one.
      ...(usedFormats.length > 1
        ? [
            h("div", { class: "sidebar-heading" }, h("span", {}, t("formats"))),
            h("ul", {}, ...usedFormats.map((f) => sidebarItem({ kind: "format", id: f.id }, f.name, count({ kind: "format", id: f.id })))),
          ]
        : []),
      h("ul", { class: "sidebar-bottom" }, sidebarItem({ kind: "trash" }, t("trash"), count({ kind: "trash" }))),
    );
  };

  const bookCard = (book: Book) => {
    const isSelected = selected.has(book.id);
    const cover = book.cover
      ? h("img", { class: "cover", src: book.cover, alt: "", loading: "lazy" })
      : h("div", { class: "cover placeholder" }, book.format.toUpperCase());
    const badges = h(
      "span",
      { class: "badges" },
      book.favorite ? h("span", { title: t("favorites") }, "★") : null,
      book.readAt !== null ? h("span", { title: t("read") }, "✓") : null,
      book.annotationCount ? h("span", { title: t("notes") }, `✎ ${book.annotationCount}`) : null,
    );
    const card = h(
      "article",
      { class: "book-card", "aria-selected": selecting || selected.size ? String(isSelected) : undefined },
      h(
        "button",
        {
          class: "book-open",
          title: book.title,
          onclick: (e: MouseEvent) => {
            if (selecting || selected.size || e.ctrlKey || e.metaKey || e.shiftKey) return toggleSelected(book, e);
            if (book.deletedAt === null) onOpen(book);
          },
        },
        h("span", { class: "cover-wrap" }, cover, badges, selecting || selected.size ? h("span", { class: "check" }, isSelected ? "✓" : "") : null),
        h("span", { class: "book-title" }, book.title),
        h("span", { class: "book-author" }, book.author ?? t("unknownAuthor")),
        h(
          "span",
          { class: "progress", role: "progressbar", "aria-valuenow": Math.round(book.progress * 100) },
          h("span", { style: `width:${(book.progress * 100).toFixed(1)}%` }),
        ),
      ),
      h(
        "button",
        {
          class: "icon item-menu card-menu",
          "aria-label": `${book.title}: ${t("properties")}`,
          onclick: (e: Event) => openMenuAt(e.currentTarget as HTMLElement, cardMenu(book)),
        },
        "⋯",
      ),
    );
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const targets = selected.has(book.id) && selected.size > 1 ? books.filter((b) => selected.has(b.id)) : null;
      openMenu(e.clientX, e.clientY, targets ? bookActions(targets) : cardMenu(book));
    });
    return card;
  };

  const drawViewHeader = () => {
    const actions: HTMLElement[] = [];
    if (view.kind === "trash" && booksInView(books, view).length) {
      const ids = booksInView(books, view).map((b) => b.id);
      actions.push(
        h("button", { onclick: () => run(() => api.restoreBooks(ids)) }, t("restoreAll")),
        h(
          "button",
          {
            class: "danger",
            onclick: async () => {
              if (await confirmDialog(t("confirmEmptyTrash"))) await run(() => api.emptyTrash());
            },
          },
          t("emptyTrash"),
        ),
      );
    }
    viewHeader.replaceChildren(h("h2", {}, viewLabel(view)), h("div", { class: "view-actions" }, ...actions));
  };

  const drawBanner = () => {
    const book = view.kind === "all" && !query ? continueCandidate(books) : null;
    banner.hidden = !book;
    if (book) {
      banner.replaceChildren(
        h(
          "button",
          { class: "continue-button", onclick: () => onOpen(book) },
          h("span", { class: "muted" }, t("continueReading")),
          h("strong", {}, book.title),
          h("span", { class: "muted" }, `${Math.round(book.progress * 100)}%`),
        ),
      );
    }
  };

  const drawGrid = () => {
    const list = visible();
    grid.replaceChildren(...list.map(bookCard));
    if (!list.length) {
      const text = !books.length
        ? t("emptyLibrary")
        : query
          ? t("noResults")
          : view.kind === "trash"
            ? t("emptyTrashView")
            : t("emptyView", viewLabel(view));
      grid.append(h("p", { class: "empty" }, text));
    }
  };

  const drawSelectionBar = () => {
    selectionBar.hidden = !selecting && selected.size === 0;
    if (selectionBar.hidden) return;
    const targets = books.filter((b) => selected.has(b.id));
    const ids = visible().map((b) => b.id);
    selectionBar.replaceChildren(
      h("span", {}, t("nSelected", String(selected.size))),
      h(
        "button",
        {
          onclick: () => {
            ids.forEach((id) => selected.add(id));
            draw();
          },
        },
        t("selectAll"),
      ),
      h(
        "button",
        {
          onclick: () => {
            selected.clear();
            selecting = false;
            draw();
          },
        },
        t("clearSelection"),
      ),
      h("span", { class: "spacer" }),
      ...(targets.length
        ? bookActions(targets)
            .filter((item): item is Exclude<MenuItem, "separator"> => item !== "separator")
            .map((item) =>
              h(
                "button",
                {
                  class: item.danger ? "danger" : undefined,
                  onclick: (e: Event) =>
                    item.submenu ? openMenuAt(e.currentTarget as HTMLElement, item.submenu) : void item.action?.(),
                },
                item.label,
              ),
            )
        : []),
    );
  };

  const draw = () => {
    drawSidebar();
    drawViewHeader();
    drawBanner();
    drawGrid();
    drawSelectionBar();
  };

  // --- Layout ----------------------------------------------------------------------

  const sortSelect = h(
    "select",
    {
      "aria-label": t("sortBy"),
      title: t("sortBy"),
      onchange: (e: Event) => {
        sort = (e.target as HTMLSelectElement).value as SortKey;
        store(SORT_KEY, sort);
        draw();
      },
    },
    ...SORT_KEYS.map((key) =>
      h("option", { value: key, selected: key === sort }, t(`sort${key[0].toUpperCase()}${key.slice(1)}` as Parameters<typeof t>[0])),
    ),
  );

  const header = h(
    "header",
    { class: "toolbar" },
    h("h1", {}, t("appName")),
    h("input", {
      type: "search",
      class: "search",
      placeholder: t("searchLibrary"),
      "aria-label": t("searchLibrary"),
      oninput: (e: Event) => {
        query = (e.target as HTMLInputElement).value;
        drawBanner();
        drawGrid();
      },
    }),
    sortSelect,
    h(
      "button",
      {
        onclick: () => {
          selecting = !selecting;
          if (!selecting) selected.clear();
          draw();
        },
      },
      t("select"),
    ),
    h("button", { onclick: () => void pickFolder() }, t("addFolder")),
    h("button", { class: "primary", onclick: () => void pickFiles() }, t("addBooks")),
  );

  root.replaceChildren(
    h(
      "div",
      { class: "library" },
      header,
      h("div", { class: "library-body" }, sidebar, h("main", { class: "library-main" }, viewHeader, banner, status, grid)),
      selectionBar,
      dropOverlay,
    ),
  );

  const unlisten = await onFilesDropped(
    (over) => (dropOverlay.hidden = !over),
    (paths) => void addPaths(paths),
  );
  // Stop listening once the library is replaced by the reader.
  new MutationObserver((_, observer) => {
    if (!root.contains(header)) {
      unlisten();
      observer.disconnect();
    }
  }).observe(root, { childList: true });

  await refresh();
}
