import { open } from "@tauri-apps/plugin-dialog";
import { api, type Book, type Category, type FormatInfo } from "../../api";

import { t } from "../../i18n";
import { confirmDialog, deleteBooksDialog, promptDialog, alertDialog } from "../dialogs";
import { h } from "../dom";
import { openMenu, openMenuAt, type MenuItem } from "../menu";
import { openProperties } from "./properties";
import { icon } from "../icons";
import { supportCard } from "../support-dialog";
import { focusSearchOnCtrlF, searchBox as searchField, viewToggle } from "../notes-page";
import type { IconName } from "../icons";
import { importWithProgress } from "../import-progress";
import {
  booksInView,
  categoryColor,
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
const SIDEBAR_KEY = "library-sidebar";
/** Below this width the sidebar is a drawer over the books. */
const NARROW = window.matchMedia("(max-width: 900px)");
const SORT_KEY = "library-sort";
const LAYOUT_KEY = "library-layout";

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

/** Stable hue per title so books without a cover get different colors. */
function coverHue(title: string): number {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return [18, 210, 140, 340, 230, 35, 28, 200, 0, 150, 270, 45][hash % 12];
}

/** Listens for files dropped on the window. Returns an unsubscribe function. */
async function onFilesDropped(onHover: (over: boolean) => void, onDrop: (paths: string[]) => void): Promise<() => void> {
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

export async function renderLibrary(root: HTMLElement, onOpen: (book: Book, jumpTo?: string) => void, initialView?: string): Promise<void> {
  const formats: FormatInfo[] = await api.supportedFormats();
  let books: Book[] = [];
  let categories: Category[] = [];
  if (initialView) store(VIEW_KEY, initialView);
  let view: View = parseViewKey(stored(VIEW_KEY));
  if (view.kind === "notebook") view = { kind: "all" };
  let layout: "grid" | "list" = stored(LAYOUT_KEY) === "list" ? "list" : "grid";
  let sort: SortKey = (SORT_KEYS as string[]).includes(stored(SORT_KEY) ?? "") ? (stored(SORT_KEY) as SortKey) : "recent";
  let query = "";
  let selecting = false;
  let lastClicked: number | null = null;
  const selected = new Set<number>();

  const sidebar = h("nav", { class: "sidebar", id: "library-sidebar", "aria-label": t("categories") });
  const banner = h("section", { class: "continue-card", "aria-label": t("continueReading") });
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
    if (NARROW.matches && narrowOpen) onNarrowChange();
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
    await importWithProgress(paths, refresh);
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

  /** Deletes books for good, asking whether their files go too. */
  const deleteForever = async (ids: number[] | "trash") => {
    const count = ids === "trash" ? booksInView(books, { kind: "trash" }).length : ids.length;
    const choice = await deleteBooksDialog(count);
    if (!choice) return;
    await run(async () => {
      const failed = ids === "trash" ? await api.emptyTrash(choice.deleteFiles) : await api.deleteBooks(ids, choice.deleteFiles);
      selected.clear();
      if (failed.length) await alertDialog(`${t("deleteFailed")}\n\n${failed.join("\n")}`);
      else status.textContent = choice.deleteFiles ? t("deletedWithFiles", String(count)) : t("deletedFromLibrary", String(count));
    });
  };

  /** Menu entries that apply to a set of books (one card or the selection). */
  const bookActions = (targets: Book[]): MenuItem[] => {
    const ids = targets.map((b) => b.id);
    if (targets.every((b) => b.deletedAt !== null)) {
      return [
        { label: t("restore"), action: () => run(() => api.restoreBooks(ids)) },
        { label: `${t("deletePermanently")}…`, danger: true, action: () => deleteForever(ids) },
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

  /** Sidebar row from the design: icon (or category dot), label and count. */
  const sidebarItem = (v: View, label: string, count: number, lead: IconName | { dot: string }, extra?: HTMLElement) =>
    h(
      "li",
      { class: "sidebar-item" },
      h(
        "button",
        { "aria-current": sameView(v, view) ? "page" : undefined, onclick: () => setView(v) },
        typeof lead === "string" ? icon(lead) : h("span", { class: "dot", style: `background:${lead.dot}` }),
        h("span", { class: "label" }, label),
        h("span", { class: "count" }, String(count)),
      ),
      extra,
    );

  const VIEW_ICONS: Array<[View["kind"], IconName]> = [
    ["all", "library"],
    ["recent", "history"],
    ["favorites", "star"],
    ["read", "circle-check"],
    ["uncategorized", "inbox"],
    ["trash", "trash-2"],
  ];

  const drawSidebar = () => {
    const count = (v: View) => booksInView(books, v).length;
    const usedFormats = formats.filter((f) => books.some((b) => b.format === f.id && b.deletedAt === null));
    sidebar.replaceChildren(
      h(
        "button",
        {
          type: "button",
          class: "add-books",
          "aria-haspopup": "menu",
          onclick: (e: Event) =>
            openMenuAt(e.currentTarget as HTMLElement, [
              { label: t("addFiles"), action: () => pickFiles() },
              { label: t("addFolder"), action: () => pickFolder() },
            ]),
        },
        icon("plus"),
        h("span", {}, t("addBooks")),
      ),
      h(
        "ul",
        { class: "side-views" },
        ...VIEW_ICONS.map(([kind, ic]) => sidebarItem({ kind } as View, t(kind), count({ kind } as View), ic)),
      ),
      h("div", { class: "sidebar-heading" }, h("span", {}, t("categories"))),
      h(
        "ul",
        {},
        ...categories.map((c) =>
          sidebarItem(
            { kind: "category", id: c.id },
            c.name,
            count({ kind: "category", id: c.id }),
            { dot: categoryColor(c.id) },
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
        h("li", { class: "sidebar-item" }, h("button", { onclick: () => newCategory() }, icon("plus"), h("span", { class: "label" }, t("newCategory")))),
      ),
      // Formats only help once the library mixes more than one.
      ...(usedFormats.length > 1
        ? [
            h("div", { class: "sidebar-heading" }, h("span", {}, t("formats"))),
            h("ul", {}, ...usedFormats.map((f) => sidebarItem({ kind: "format", id: f.id }, f.name, count({ kind: "format", id: f.id }), f.id === "pdf" ? "file-text" : "book-text"))),
          ]
        : []),
      h("div", { class: "side-bottom" }, supportCard()),
    );
  };

  const bookCard = (book: Book) => {
    const isSelected = selected.has(book.id);
    // Without a cover, the thumbnail shows the book's own title and author.
    const cover = book.cover
      ? h("img", { class: "cover", src: book.cover, alt: "", loading: "lazy" })
      : h(
          "div",
          { class: "cover placeholder", "aria-hidden": "true", style: `--cover-hue:${coverHue(book.title)}` },
          h("span", { class: "ph-title" }, book.title),
          book.author ? h("span", { class: "ph-author" }, book.author) : null,
          h("span", { class: "ph-format" }, book.format.toUpperCase()),
        );
    const badges = h(
      "span",
      { class: "badges" },
      book.favorite ? h("span", { title: t("favorites") }, "★") : null,
      book.readAt !== null ? h("span", { title: t("read") }, "✓") : null,
      book.annotationCount ? h("span", { title: t("notes") }, `✎ ${book.annotationCount}`) : null,
    );
    const card = h(
      "article",
      { class: `book-card${isSelected ? " is-selected" : ""}` },
      h(
        "button",
        {
          class: "book-open",
          title: book.title,
          // In selection mode the card is a toggle; screen readers hear "pressed".
          "aria-pressed": selecting || selected.size ? String(isSelected) : undefined,
          onclick: (e: MouseEvent) => {
            if (selecting || selected.size || e.ctrlKey || e.metaKey || e.shiftKey) return toggleSelected(book, e);
            if (book.deletedAt === null) onOpen(book);
          },
        },
        h("span", { class: "cover-wrap" }, cover, badges, selecting || selected.size ? h("span", { class: "check", "aria-hidden": "true" }, isSelected ? "✓" : "") : null),
        h("span", { class: "book-title" }, book.title),
        h("span", { class: "book-author" }, book.author ?? t("unknownAuthor")),
        h(
          "span",
          { class: "book-state" },
          h("span", { class: "book-format" }, book.format.toUpperCase()),
          book.readAt !== null
            ? h("span", { class: "state-read" }, `· ${t("stateRead")}`)
            : book.progress > 0
              ? h("span", {}, `· ${Math.round(book.progress * 100)} %`)
              : h("span", {}, `· ${t("stateNew")}`),
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

  const titleEl = h("h1", { class: "lib-title" });
  const subtitleEl = h("p", { class: "lib-sub" });
  const drawViewHeader = () => {
    const inView = booksInView(books, view);
    titleEl.textContent = view.kind === "all" ? t("allBooksTitle") : viewLabel(view);
    subtitleEl.textContent = t("libSubtitle", String(inView.length), String(inView.filter((b) => b.progress > 0 && b.readAt === null).length));
    const actions: HTMLElement[] = [];
    if (view.kind === "trash" && inView.length) {
      const ids = inView.map((b) => b.id);
      actions.push(
        h("button", { class: "btn-outline", onclick: () => run(() => api.restoreBooks(ids)) }, t("restoreAll")),
        h("button", { class: "btn-outline danger", onclick: () => deleteForever("trash") }, t("emptyTrash")),
      );
    }
    viewHeader.hidden = !actions.length;
    viewHeader.replaceChildren(h("div", { class: "view-actions" }, ...actions));
  };

  const drawBanner = () => {
    const book = view.kind === "all" && !query ? continueCandidate(books) : null;
    banner.hidden = !book;
    if (!book) return;
    const pct = Math.round(book.progress * 100);
    banner.replaceChildren(
      book.cover
        ? h("img", { class: "cc-cover", src: book.cover, alt: "" })
        : h("div", { class: "cc-cover placeholder", "aria-hidden": "true" }, h("span", { class: "ph-title" }, book.title)),
      h(
        "div",
        { class: "cc-info" },
        h("p", { class: "cc-eyebrow" }, t("continueReading")),
        h("p", { class: "cc-title" }, book.title),
        h("p", { class: "cc-detail" }, [book.author, book.format.toUpperCase()].filter(Boolean).join(" · ")),
        h(
          "div",
          { class: "cc-progress" },
          h("span", { class: "cc-track", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": t("progress") }, h("span", { style: `width:${pct}%` })),
          h("span", { class: "cc-pct" }, `${pct} %`),
        ),
      ),
      h("button", { type: "button", class: "btn-primary", onclick: () => onOpen(book) }, h("span", {}, t("continue")), icon("arrow-right")),
    );
  };

  const drawGrid = () => {
    grid.dataset.layout = layout;
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
      h("span", { role: "status" }, selected.size ? t("nSelected", String(selected.size)) : t("selectHint")),
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
        t("doneSelecting"),
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
    drawSelectButton();
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
  const sortField = h("label", { class: "sort-field" }, icon("arrow-down-up"), sortSelect);

  const searchInput = h("input", {
    type: "search",
    placeholder: t("searchLibrary"),
    "aria-label": t("searchLibrary"),
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value;
      drawBanner();
      drawGrid();
    },
  }) as HTMLInputElement;
  const layoutSwitch = viewToggle((l) => {
    layout = l;
    store(LAYOUT_KEY, l);
    drawGrid();
  }, layout);

  const selectButton = h("button", { class: "btn-outline select-toggle", "aria-pressed": "false", onclick: () => setSelecting(!selecting) });
  function setSelecting(on: boolean) {
    selecting = on;
    if (!on) selected.clear();
    draw();
  }
  function drawSelectButton() {
    const on = selecting || selected.size > 0;
    selectButton.setAttribute("aria-pressed", String(on));
    selectButton.replaceChildren(icon(on ? "check" : "select"), h("span", { class: "btn-label" }, on ? t("doneSelecting") : t("select")));
  }

  // --- Sidebar: collapsible; a drawer over the books on narrow windows ---
  let wideOpen = stored(SIDEBAR_KEY) !== "closed";
  let narrowOpen = false;
  const sidebarOpen = () => (NARROW.matches ? narrowOpen : wideOpen);
  const sidebarButton = h("button", {
    class: "icon-btn sidebar-toggle",
    "aria-controls": "library-sidebar",
    onclick: () => {
      if (NARROW.matches) narrowOpen = !narrowOpen;
      else {
        wideOpen = !wideOpen;
        store(SIDEBAR_KEY, wideOpen ? "open" : "closed");
      }
      applySidebar();
      if (sidebarOpen()) sidebar.querySelector<HTMLElement>("[aria-current=page]")?.focus();
    },
  });
  function applySidebar() {
    const open = sidebarOpen();
    root.querySelector(".library")?.setAttribute("data-sidebar", open ? "open" : "closed");
    sidebarButton.setAttribute("aria-expanded", String(open));
    sidebarButton.replaceChildren(icon("sidebar"));
    sidebarButton.setAttribute("aria-label", open ? t("hideSidebar") : t("showSidebar"));
    sidebarButton.title = open ? t("hideSidebar") : t("showSidebar");
  }
  const onNarrowChange = () => {
    narrowOpen = false;
    applySidebar();
  };
  NARROW.addEventListener("change", onNarrowChange);
  const backdrop = h("div", { class: "sidebar-backdrop", onclick: onNarrowChange });

  const header = h(
    "header",
    { class: "lib-toolbar" },
    sidebarButton,
    h("div", { class: "lib-heading" }, titleEl, subtitleEl),
    searchField(searchInput),
    sortField,
    layoutSwitch,
    selectButton,
  );

  root.replaceChildren(
    h(
      "div",
      { class: "library" },
      h("div", { class: "library-body" }, sidebar, backdrop, h("main", { class: "library-main" }, header, viewHeader, banner, status, grid)),
      selectionBar,
      dropOverlay,
    ),
  );

  applySidebar();
  focusSearchOnCtrlF(searchInput, root);
  // Esc closes the drawer or leaves selection mode (dialogs and menus handle their own Esc).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || document.querySelector("dialog[open], .menu")) return;
    if (NARROW.matches && narrowOpen) {
      onNarrowChange();
      sidebarButton.focus();
    } else if (selecting || selected.size) setSelecting(false);
  };
  document.addEventListener("keydown", onKey);

  const unlisten = await onFilesDropped(
    (over) => (dropOverlay.hidden = !over),
    (paths) => void addPaths(paths),
  );
  // Stop listening once the library is replaced by the reader.
  new MutationObserver((_, observer) => {
    if (!root.contains(header)) {
      unlisten();
      document.removeEventListener("keydown", onKey);
      NARROW.removeEventListener("change", onNarrowChange);
      observer.disconnect();
    }
  }).observe(root, { childList: true });

  await refresh();
}
