import { api, type Bookmark } from "../../api";
import type { ReaderSession, ReadingPosition, SearchResult, TocItem } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";

export type PanelTab = "toc" | "bookmarks" | "search";

const MAX_RESULTS = 500;

interface Deps {
  bookId: number;
  session: ReaderSession;
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

function percent(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}

export function createSidePanel({ bookId, session, position }: Deps) {
  let tab: PanelTab = "toc";
  let searchAbort: AbortController | null = null;

  const tabs = h("div", { class: "panel-tabs", role: "tablist" });
  const body = h("div", { class: "panel-body" });
  const el = h("aside", { class: "side-panel", hidden: true }, tabs, body);

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
              {},
              h(
                "button",
                { class: "list-item", onclick: () => void session.goTo(mark.location) },
                h("span", {}, mark.label),
                h("span", { class: "muted" }, percent(mark.progress)),
              ),
              h(
                "button",
                {
                  class: "icon",
                  title: t("remove"),
                  "aria-label": t("remove"),
                  onclick: async () => drawBookmarks(await api.removeBookmark(mark.id, bookId)),
                },
                "×",
              ),
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
            if (!confirm(t("confirmClearBookmarks"))) return;
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
  const searchForm = h(
    "form",
    {
      class: "panel-actions",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void runSearch(searchInput.value);
      },
    },
    searchInput,
    h("button", { type: "submit" }, t("search")),
  );
  const searchView = h("div", {}, searchForm, searchStatus, results);

  // --- Tabs ---------------------------------------------------------------
  const views: Record<PanelTab, HTMLElement> = { toc: tocView, bookmarks: bookmarksView, search: searchView };
  const labels: Record<PanelTab, string> = { toc: t("contents"), bookmarks: t("bookmarks"), search: t("search") };

  // Search highlights only make sense while the results are visible.
  const leaveSearch = () => {
    searchAbort?.abort();
    session.clearSearch();
  };

  const select = (next: PanelTab) => {
    if (tab === "search" && next !== "search") leaveSearch();
    tab = next;
    tabs.replaceChildren(
      ...(Object.keys(views) as PanelTab[]).map((key) =>
        h("button", { role: "tab", "aria-selected": String(key === tab), onclick: () => select(key) }, labels[key]),
      ),
    );
    body.replaceChildren(views[tab]);
    if (tab === "search") searchInput.focus();
  };

  void api.listBookmarks(bookId).then(drawBookmarks);
  select(tab);

  return {
    el,
    isOpen: () => !el.hidden,
    open(next: PanelTab) {
      el.hidden = false;
      select(next);
    },
    toggle(next: PanelTab) {
      if (!el.hidden && tab === next) this.close();
      else this.open(next);
    },
    close() {
      if (tab === "search" && !el.hidden) leaveSearch();
      el.hidden = true;
    },
    addBookmark,
    destroy() {
      searchAbort?.abort();
    },
  };
}
