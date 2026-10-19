import "foliate-js/view.js";
import {
  makeBook,
  type FoliateTocItem,
  type FoliateView,
  type RelocateDetail,
} from "foliate-js/view.js";
import { FONT_STACKS, THEME_COLORS } from "../ui/theme";
import type { FormatPlugin, ReaderSettings, ReadingPosition, TocItem } from "./types";

type LangMap = string | Record<string, string> | undefined;

function langString(value: LangMap): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return Object.values(value)[0];
}

function authorString(author: unknown): string | undefined {
  const list = Array.isArray(author) ? author : author ? [author] : [];
  const names = list
    .map((a) => (typeof a === "object" && a && "name" in a ? langString(a.name as LangMap) : langString(a as LangMap)))
    .filter(Boolean);
  return names.length ? names.join(", ") : undefined;
}

function mapToc(items: FoliateTocItem[] | null | undefined): TocItem[] {
  return (items ?? []).map((item) => ({
    label: item.label?.trim() || "—",
    target: item.href,
    children: item.subitems ? mapToc(item.subitems) : undefined,
  }));
}

const TEXT_BLOCKS = "p, li, blockquote, dd, div";

function bookCss({ theme, fontSize, fontFamily, lineHeight, textAlign }: ReaderSettings): string {
  const c = THEME_COLORS[theme];
  const dark = theme === "dark" || theme === "night-sepia";
  return `
    html { color-scheme: ${dark ? "dark" : "light"}; font-size: ${fontSize}% !important; }
    html, body { background: ${c.bg} !important; color: ${c.fg} !important; }
    a:link, a:visited { color: ${c.link} !important; }
    ${TEXT_BLOCKS} { line-height: ${lineHeight} !important; }
    ${fontFamily === "original" ? "" : `body, body *:not(code):not(pre):not(kbd) { font-family: ${FONT_STACKS[fontFamily]} !important; }`}
    ${textAlign === "original" ? "" : `p, li, blockquote, dd { text-align: ${textAlign} !important; }`}
    pre { white-space: pre-wrap !important; }
  `;
}

function applyLayout(view: FoliateView, settings: ReaderSettings): void {
  view.renderer.setAttribute("max-column-count", settings.layout === "double" ? "2" : "1");
  view.renderer.setStyles?.(bookCss(settings));
}

export const epubPlugin: FormatPlugin = {
  id: "epub",
  name: "EPUB",

  async extractMetadata(file) {
    const book = await makeBook(file);
    try {
      return {
        title: langString(book.metadata?.title),
        author: authorString(book.metadata?.author),
        cover: (await book.getCover?.()) ?? null,
      };
    } finally {
      book.destroy?.();
    }
  },

  async open(container, file, { location, settings }) {
    const view = document.createElement("foliate-view") as FoliateView;
    view.classList.add("epub-view");
    container.append(view);
    await view.open(file);
    view.renderer.setAttribute("flow", "paginated");
    applyLayout(view, settings);

    // Key presses inside the book's iframe never reach the app; forward them
    // so reader shortcuts keep working while the text has focus.
    view.addEventListener("load", (e) => {
      const { doc } = (e as CustomEvent<{ doc: Document }>).detail;
      doc.addEventListener("keydown", (ev) => document.dispatchEvent(new KeyboardEvent("keydown", ev)));
    });

    const listeners: Array<(p: ReadingPosition) => void> = [];
    view.addEventListener("relocate", (e) => {
      const detail = (e as CustomEvent<RelocateDetail>).detail;
      if (!detail.cfi) return;
      const position = { location: detail.cfi, progress: Number.isFinite(detail.fraction) ? detail.fraction! : 0, label: detail.tocItem?.label };
      listeners.forEach((l) => l(position));
    });

    await view.init({ lastLocation: location ?? null, showTextStart: true });

    return {
      capabilities: { reflowable: true, pages: false, fit: false },
      next: () => view.next(),
      prev: () => view.prev(),
      goTo: async (target) => void (await view.goTo(target)),
      goToFraction: (fraction) => view.goToFraction(Math.min(Math.max(fraction, 0), 1)),
      back: async () => view.history.back(),
      canGoBack: () => view.history.canGoBack,
      toc: () => mapToc(view.book.toc),
      async search(query, onResult, signal) {
        for await (const event of view.search({ query })) {
          if (signal.aborted) break;
          if (typeof event === "object" && "subitems" in event) {
            for (const { cfi, excerpt } of event.subitems) {
              onResult({ target: cfi, section: event.label, excerpt });
            }
          }
        }
      },
      clearSearch: () => view.clearSearch(),
      applySettings: (s) => applyLayout(view, s),
      onRelocate: (l) => void listeners.push(l),
      destroy: () => {
        view.close();
        view.book.destroy?.();
        view.remove();
      },
    };
  },
};
