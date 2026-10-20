import { api, type Annotation } from "../../api";
import type { ReaderSession, TextSelection } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";
import { lookups, openExternal } from "../external";
import { icon } from "../icons";

/** Stored by name so the palette can change without touching saved notes. */
export const HIGHLIGHT_COLORS = {
  yellow: { css: "#f5c518", color: "colorYellow", meaning: "labelImportant" },
  green: { css: "#5cc86b", color: "colorGreen", meaning: "labelIdea" },
  blue: { css: "#4ea1f3", color: "colorBlue", meaning: "labelDefinition" },
  pink: { css: "#f472b6", color: "colorPink", meaning: "labelQuestion" },
  purple: { css: "#a78bfa", color: "colorPurple", meaning: "labelQuote" },
} as const;

export type ColorName = keyof typeof HIGHLIGHT_COLORS;
export const COLOR_NAMES = Object.keys(HIGHLIGHT_COLORS) as ColorName[];

export const cssColor = (name: string) => HIGHLIGHT_COLORS[name as ColorName]?.css ?? HIGHLIGHT_COLORS.yellow.css;

// --- What each color means to the reader -------------------------------------

/** Color name -> the meaning the reader gave it ("Important", "Question"…). */
export type Labels = Record<ColorName, string>;

const LABELS_KEY = "highlight-labels";

export const defaultLabels = (): Labels =>
  Object.fromEntries(COLOR_NAMES.map((c) => [c, t(HIGHLIGHT_COLORS[c].meaning)])) as Labels;

export async function loadLabels(): Promise<Labels> {
  const saved = await api.getSetting<Partial<Labels>>(LABELS_KEY).catch(() => null);
  const labels = defaultLabels();
  for (const c of COLOR_NAMES) if (saved?.[c]?.trim()) labels[c] = saved[c]!.trim();
  return labels;
}

export async function saveLabels(labels: Labels): Promise<void> {
  await api.setSetting(LABELS_KEY, labels);
}

/** A color dot plus its meaning: color is never the only cue (WCAG 1.4.1). */
export function labelChip(color: string, labels: Labels): HTMLElement {
  return h(
    "span",
    { class: "label-chip" },
    h("span", { class: "dot", style: `--dot:${cssColor(color)}`, "aria-hidden": "true" }),
    labels[color as ColorName] ?? color,
  );
}

const MAX_LOOKUP_CHARS = 200;

interface Deps {
  bookId: number;
  session: ReaderSession;
  labels: Labels;
  /** Opens the side panel search with this query. */
  searchInBook: (query: string) => void;
}

/**
 * Keeps the book's highlights and notes in sync with the backend and the page,
 * and shows the floating toolbar for selections and existing highlights.
 */
export function createAnnotator({ bookId, session, labels, searchInBook }: Deps) {
  let items: Annotation[] = [];
  let lastColor: ColorName = "yellow";
  let returnFocus: HTMLElement | null = null;
  const listeners: Array<(list: Annotation[]) => void> = [];

  const popup = h("div", { class: "annotation-popup", role: "dialog", "aria-label": t("highlightAs"), hidden: true });

  const notify = () => listeners.forEach((l) => l(items));

  const apply = (list: Annotation[]) => {
    items = list;
    session.setHighlights(items.map((a) => ({ location: a.location, color: cssColor(a.color), note: Boolean(a.note) })));
    notify();
  };

  const hide = () => {
    popup.hidden = true;
    popup.replaceChildren();
    returnFocus?.focus();
    returnFocus = null;
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

  /** One button per color, each showing its meaning. */
  const colorChoices = (current: string | null, onPick: (color: ColorName) => void) =>
    h(
      "div",
      { class: "label-choices", role: "group", "aria-label": t("highlightAs") },
      ...COLOR_NAMES.map((name) =>
        h(
          "button",
          {
            class: "label-choice",
            "aria-pressed": String(current === name),
            title: `${t(HIGHLIGHT_COLORS[name].color)}: ${labels[name]}`,
            onclick: () => onPick(name),
          },
          labelChip(name, labels),
        ),
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
      h("p", { class: "popup-title" }, t("highlightAs")),
      colorChoices(null, (color) => void create(sel, color).then(hide)),
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
      colorChoices(a.color, (color) => void update(a, a.note, color).then(hide)),
      ...(a.note ? [h("p", { class: "popup-note" }, icon("note"), h("span", {}, a.note))] : []),
      h(
        "div",
        { class: "popup-actions" },
        h(
          "button",
          { class: "primary", onclick: () => noteEditor(a.note ?? "", rect, (note) => update(a, note, a.color)) },
          a.note ? t("editNote") : t("addNote"),
        ),
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
    labels: () => labels,
    isOpen: () => !popup.hidden,
    hide,
    list: () => items,
    onChange: (l: (list: Annotation[]) => void) => void listeners.push(l),
    update,
    remove,
    /** Opens the note editor for an annotation shown in the notes panel. */
    editNote: (a: Annotation, anchor: HTMLElement) => {
      returnFocus = anchor;
      noteEditor(a.note ?? "", anchor.getBoundingClientRect(), (note) => update(a, note, a.color));
    },
    /** New meanings from the settings panel; redraws lists that show them. */
    setLabels(next: Labels) {
      Object.assign(labels, next);
      notify();
    },
    clear: async () => {
      await api.clearAnnotations(bookId);
      apply([]);
    },
  };
}

export type Annotator = ReturnType<typeof createAnnotator>;
