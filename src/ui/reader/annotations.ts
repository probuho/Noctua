import { api, type Annotation } from "../../api";
import type { ReaderSession, TextSelection } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";
import { lookups, openExternal } from "../external";

/** Stored by name so the palette can change without touching saved notes. */
export const HIGHLIGHT_COLORS = {
  yellow: { css: "#f5c518", label: "colorYellow" },
  green: { css: "#5cc86b", label: "colorGreen" },
  blue: { css: "#4ea1f3", label: "colorBlue" },
  pink: { css: "#f472b6", label: "colorPink" },
  purple: { css: "#a78bfa", label: "colorPurple" },
} as const;

export type ColorName = keyof typeof HIGHLIGHT_COLORS;
const COLOR_NAMES = Object.keys(HIGHLIGHT_COLORS) as ColorName[];

export const cssColor = (name: string) => HIGHLIGHT_COLORS[name as ColorName]?.css ?? HIGHLIGHT_COLORS.yellow.css;

const MAX_LOOKUP_CHARS = 200;

interface Deps {
  bookId: number;
  session: ReaderSession;
  /** Opens the side panel search with this query. */
  searchInBook: (query: string) => void;
}

/**
 * Keeps the book's highlights and notes in sync with the backend and the page,
 * and shows the floating toolbar for selections and existing highlights.
 */
export function createAnnotator({ bookId, session, searchInBook }: Deps) {
  let items: Annotation[] = [];
  let lastColor: ColorName = "yellow";
  const listeners: Array<(list: Annotation[]) => void> = [];

  const popup = h("div", { class: "annotation-popup", role: "dialog", hidden: true });

  const apply = (list: Annotation[]) => {
    items = list;
    session.setHighlights(items.map((a) => ({ location: a.location, color: cssColor(a.color) })));
    listeners.forEach((l) => l(items));
  };

  const hide = () => {
    popup.hidden = true;
    popup.replaceChildren();
  };

  /** Places the popup above the rect (or below when there is no room). */
  const place = (rect: DOMRect) => {
    popup.hidden = false;
    const { width, height } = popup.getBoundingClientRect();
    const above = rect.top - height - 8;
    const top = above > 8 ? above : Math.min(rect.bottom + 8, innerHeight - height - 8);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), innerWidth - width - 8);
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  };

  const lookupButtons = (text: string) => {
    const query = text.slice(0, MAX_LOOKUP_CHARS);
    return [
      h(
        "button",
        {
          onclick: async () => {
            await navigator.clipboard?.writeText(text).catch(() => {});
            hide();
            session.clearSelection();
          },
        },
        t("copy"),
      ),
      h("button", { onclick: () => (hide(), searchInBook(query)) }, t("searchInBook")),
      h("button", { onclick: () => void openExternal(lookups.google(query)) }, t("searchGoogle")),
      h("button", { onclick: () => void openExternal(lookups.wikipedia(query)) }, t("searchWikipedia")),
      h("button", { onclick: () => void openExternal(lookups.translate(query)) }, t("translate")),
    ];
  };

  const swatches = (current: string | null, onPick: (color: ColorName) => void) =>
    h(
      "div",
      { class: "swatches" },
      ...COLOR_NAMES.map((name) =>
        h("button", {
          class: "highlight-swatch",
          style: `--swatch:${HIGHLIGHT_COLORS[name].css}`,
          title: t(HIGHLIGHT_COLORS[name].label),
          "aria-label": t(HIGHLIGHT_COLORS[name].label),
          "aria-pressed": String(current === name),
          onclick: () => onPick(name),
        }),
      ),
    );

  const noteEditor = (initial: string, rect: DOMRect, onSave: (note: string) => Promise<void>) => {
    const textarea = h("textarea", { rows: 4, placeholder: t("notePlaceholder"), "aria-label": t("note") });
    textarea.value = initial;
    popup.replaceChildren(
      h(
        "form",
        {
          class: "note-editor",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            await onSave(textarea.value);
            hide();
          },
        },
        textarea,
        h(
          "div",
          { class: "modal-actions" },
          h("button", { type: "button", onclick: hide }, t("cancel")),
          h("button", { type: "submit", class: "primary" }, t("save")),
        ),
      ),
    );
    place(rect);
    textarea.focus();
  };

  // --- New selection ---------------------------------------------------------------

  const create = async (sel: TextSelection, color: ColorName, note: string | null = null) => {
    lastColor = color;
    apply(await api.saveAnnotation({ bookId, location: sel.location, text: sel.text, note, color, progress: sel.progress }));
    session.clearSelection();
  };

  const showForSelection = (sel: TextSelection) => {
    popup.replaceChildren(
      swatches(null, (color) => void create(sel, color).then(hide)),
      h(
        "div",
        { class: "popup-actions" },
        h("button", { class: "primary", onclick: () => noteEditor("", sel.rect, (note) => create(sel, lastColor, note)) }, t("addNote")),
        ...lookupButtons(sel.text),
      ),
    );
    place(sel.rect);
  };

  // --- Existing highlight ------------------------------------------------------------

  const update = async (a: Annotation, note: string | null, color: string) =>
    apply(await api.updateAnnotation(a.id, bookId, note, color));
  const remove = async (a: Annotation) => apply(await api.deleteAnnotation(a.id, bookId));

  const showForAnnotation = (a: Annotation, rect: DOMRect) => {
    popup.replaceChildren(
      swatches(a.color, (color) => void update(a, a.note, color).then(hide)),
      ...(a.note ? [h("p", { class: "popup-note" }, a.note)] : []),
      h(
        "div",
        { class: "popup-actions" },
        h("button", { class: "primary", onclick: () => noteEditor(a.note ?? "", rect, (note) => update(a, note, a.color)) }, a.note ? t("editNote") : t("addNote")),
        h("button", { class: "danger", onclick: () => void remove(a).then(hide) }, t("deleteHighlight")),
        ...lookupButtons(a.text),
      ),
    );
    place(rect);
  };

  session.onSelect((sel) => (sel ? showForSelection(sel) : hide()));
  session.onHighlightClick((location, rect) => {
    const a = items.find((x) => x.location === location);
    if (a) showForAnnotation(a, rect);
  });

  void api.listAnnotations(bookId).then(apply);

  return {
    popup,
    isOpen: () => !popup.hidden,
    hide,
    list: () => items,
    onChange: (l: (list: Annotation[]) => void) => void listeners.push(l),
    update,
    remove,
    /** Opens the note editor for an annotation shown in the notes panel. */
    editNote: (a: Annotation, anchor: HTMLElement) =>
      noteEditor(a.note ?? "", anchor.getBoundingClientRect(), (note) => update(a, note, a.color)),
    clear: async () => {
      await api.clearAnnotations(bookId);
      apply([]);
    },
  };
}

export type Annotator = ReturnType<typeof createAnnotator>;
