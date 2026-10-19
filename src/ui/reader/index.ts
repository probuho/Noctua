import { api, loadBookFile, type Book } from "../../api";
import { getFormat, type ReaderSession, type ReadingPosition } from "../../formats";
import { t } from "../../i18n";
import { confirmDialog } from "../dialogs";
import { h } from "../dom";
import { isFullscreen, setFullscreen, toggleFullscreen } from "../fullscreen";
import { applyAppTheme, DEFAULT_SETTINGS, loadSettings, saveSettings, THEMES } from "../theme";
import { actionFor, hotkeySheet, type Action } from "./hotkeys";
import { createSettingsPanel } from "./settings-panel";
import { createAnnotator } from "./annotations";
import { createSidePanel } from "./side-panel";
import { openExternal } from "../external";

const SAVE_DELAY_MS = 800;
const SLIDER_STEPS = 1000;

export async function renderReader(root: HTMLElement, book: Book, onClose: () => void): Promise<void> {
  const settings = loadSettings();
  applyAppTheme(settings.theme);

  const stage = h("main", { class: "reader-stage" });
  const dim = h("div", { class: "dim", "aria-hidden": "true" });
  const loading = h("p", { class: "empty" }, "…");
  stage.append(loading);

  // Mount the final layout before opening the book: moving the stage in the
  // DOM afterwards would reload the book's iframes and blank the page.
  const body = h("div", { class: "reader-body" }, stage);
  const placeholderBar = h(
    "header",
    { class: "toolbar" },
    h("button", { onclick: onClose }, `← ${t("back")}`),
    h("span", { class: "reader-title" }, book.title),
  );
  const placeholderNav = h("footer", { class: "reader-nav" });
  root.replaceChildren(h("div", { class: "reader" }, placeholderBar, body, placeholderNav));

  let session: ReaderSession;
  try {
    const file = await loadBookFile(book);
    session = await getFormat(book.format).open(stage, file, { location: book.location, settings });
    loading.remove();
  } catch (err) {
    loading.textContent = t("openError", String(err));
    return;
  }
  stage.append(dim);

  // --- State ----------------------------------------------------------------
  let position: ReadingPosition | null = null;
  let pending: ReadingPosition | null = null;
  let saveTimer: number | undefined;
  let flipTimer: number | undefined;
  let sliderDragging = false;

  const flush = async () => {
    window.clearTimeout(saveTimer);
    if (pending) await api.saveProgress(book.id, pending.location, pending.progress);
    pending = null;
  };

  // --- Panels ---------------------------------------------------------------
  const annotator = session.capabilities.annotations
    ? createAnnotator({ bookId: book.id, session, searchInBook: (query) => side.search(query) })
    : null;
  const side = createSidePanel({ book, session, annotator, position: () => position });

  session.onExternalLink(async (url) => {
    if (await confirmDialog(t("openExternalLink", url), t("open"))) await openExternal(url);
  });
  let settingsPanel = createSettingsPanel(settings, session.capabilities, () => updateSettings());
  // Rebuilt on every open so values changed by hotkeys (theme, layout) show correctly.
  const toggleSettings = () => {
    help.hidden = true;
    if (!settingsPanel.isOpen()) {
      const fresh = createSettingsPanel(settings, session.capabilities, () => updateSettings());
      settingsPanel.el.replaceWith(fresh.el);
      settingsPanel = fresh;
    }
    settingsPanel.toggle();
  };
  const help = h(
    "section",
    { class: "settings-panel help-panel", hidden: true, "aria-label": t("hotkeys") },
    h("h2", {}, t("hotkeys")),
    hotkeySheet(),
  );

  const updateSettings = () => {
    saveSettings(settings);
    applyAppTheme(settings.theme);
    dim.style.opacity = String(settings.dimming);
    session.applySettings(settings);
    if (flipTimer) startAutoFlip();
  };

  // --- Toolbar --------------------------------------------------------------
  const positionLabel = h("span", { class: "position" });
  const flipButton = h(
    "button",
    { class: "icon", title: t("autoFlipStart"), "aria-label": t("autoFlipStart"), "aria-pressed": "false", onclick: () => toggleAutoFlip() },
    "▶",
  );
  const iconButton = (label: string, glyph: string, onclick: () => void) =>
    h("button", { class: "icon", title: label, "aria-label": label, onclick }, glyph);

  const toolbar = h(
    "header",
    { class: "toolbar reader-toolbar" },
    h("button", { onclick: () => void close() }, `← ${t("back")}`),
    iconButton(t("contents"), "☰", () => side.toggle("toc")),
    h("span", { class: "reader-title" }, book.title),
    positionLabel,
    iconButton(t("search"), "⌕", () => side.toggle("search")),
    iconButton(t("bookmarks"), "⚑", () => side.toggle("bookmarks")),
    annotator ? iconButton(t("notes"), "✎", () => side.toggle("notes")) : null,
    flipButton,
    iconButton(t("settings"), "Aa", toggleSettings),
    iconButton(t("fullscreen"), "⛶", () => void toggleFullscreen()),
    iconButton(t("hotkeys"), "?", () => {
      settingsPanel.close();
      help.hidden = !help.hidden;
    }),
  );

  // --- Footer: navigation, progress slider, go to page ------------------------
  const backButton = h("button", { class: "icon", title: t("goBack"), "aria-label": t("goBack"), disabled: true, onclick: () => void session.back() }, "↶");
  const slider = h("input", {
    type: "range",
    class: "progress-slider",
    min: 0,
    max: SLIDER_STEPS,
    value: 0,
    "aria-label": t("progress"),
  });
  slider.addEventListener("input", () => {
    sliderDragging = true;
    positionLabel.textContent = `${Math.round((Number(slider.value) / SLIDER_STEPS) * 100)}%`;
  });
  slider.addEventListener("change", () => {
    sliderDragging = false;
    void session.goToFraction(Number(slider.value) / SLIDER_STEPS);
  });

  const pageInput = h("input", { type: "number", class: "narrow", min: 1, "aria-label": t("page") });
  const pageTotal = h("span", { class: "muted" });
  const pageForm = session.capabilities.pages
    ? h(
        "form",
        {
          class: "page-jump",
          onsubmit: (e: Event) => {
            e.preventDefault();
            if (pageInput.value) void session.goTo(pageInput.value);
            pageInput.blur();
          },
        },
        pageInput,
        pageTotal,
      )
    : null;

  const nav = h(
    "footer",
    { class: "reader-nav" },
    iconButton(t("prev"), "‹", () => void session.prev()),
    backButton,
    slider,
    pageForm,
    iconButton(t("next"), "›", () => void session.next()),
  );

  body.prepend(side.el);
  body.append(settingsPanel.el, help);
  if (annotator) body.append(annotator.popup);
  placeholderBar.replaceWith(toolbar);
  placeholderNav.replaceWith(nav);

  // --- Relocation -------------------------------------------------------------
  session.onRelocate((pos) => {
    position = pos;
    positionLabel.textContent = pos.label ? `${pos.label} · ${Math.round(pos.progress * 100)}%` : `${Math.round(pos.progress * 100)}%`;
    if (!sliderDragging) slider.value = String(Math.round(pos.progress * SLIDER_STEPS));
    if (pos.page && document.activeElement !== pageInput) {
      pageInput.value = String(pos.page.current);
      pageInput.max = String(pos.page.total);
      pageTotal.textContent = `/ ${pos.page.total}`;
    }
    backButton.disabled = !session.canGoBack();
    annotator?.hide();

    pending = pos;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  });

  // --- Auto page turn ---------------------------------------------------------
  function startAutoFlip() {
    window.clearInterval(flipTimer);
    flipTimer = window.setInterval(() => {
      if (position && position.progress >= 0.9999) return toggleAutoFlip(false);
      void session.next();
    }, settings.autoFlipSeconds * 1000);
  }
  function toggleAutoFlip(on = !flipTimer) {
    window.clearInterval(flipTimer);
    flipTimer = undefined;
    if (on) startAutoFlip();
    const label = on ? t("autoFlipStop") : t("autoFlipStart");
    flipButton.textContent = on ? "⏸" : "▶";
    flipButton.title = label;
    flipButton.setAttribute("aria-label", label);
    flipButton.setAttribute("aria-pressed", String(on));
  }

  // --- Hotkeys ----------------------------------------------------------------
  const closeOverlays = (): boolean => {
    if (annotator?.isOpen()) {
      annotator.hide();
      session.clearSelection();
      return true;
    }
    const open = side.isOpen() || settingsPanel.isOpen() || !help.hidden;
    side.close();
    settingsPanel.close();
    help.hidden = true;
    return open;
  };

  const run: Record<Action, () => void | Promise<void>> = {
    next: () => session.next(),
    prev: () => session.prev(),
    start: () => session.goToFraction(0),
    end: () => session.goToFraction(1),
    search: () => side.open("search"),
    bookmark: () => side.addBookmark(),
    contents: () => side.toggle("toc"),
    notes: () => side.toggle("notes"),
    larger: () => settingsPanel.stepSize(10),
    smaller: () => settingsPanel.stepSize(-10),
    resetSize: () => settingsPanel.stepSize(DEFAULT_SETTINGS.fontSize - settings.fontSize),
    fullscreen: () => void toggleFullscreen(),
    back: () => session.back(),
    theme: () => {
      settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
      updateSettings();
    },
    layout: () => {
      settings.layout = settings.layout === "double" ? "single" : "double";
      updateSettings();
    },
    help: () => void (help.hidden = !help.hidden),
    close: async () => {
      if (closeOverlays()) return;
      if (await isFullscreen()) return setFullscreen(false);
      await close();
    },
  };

  const onKey = (e: KeyboardEvent) => {
    const action = actionFor(e);
    if (!action) return;
    e.preventDefault();
    void run[action]();
  };
  document.addEventListener("keydown", onKey);

  // Clicking the page closes floating panels, like most readers.
  stage.addEventListener("pointerdown", () => {
    settingsPanel.close();
    help.hidden = true;
  });

  async function close() {
    document.removeEventListener("keydown", onKey);
    toggleAutoFlip(false);
    side.destroy();
    await flush();
    if (await isFullscreen()) await setFullscreen(false);
    session.destroy();
    if (position && position.progress >= 0.99 && book.readAt === null) {
      if (await confirmDialog(t("markAsReadQuestion", book.title), t("markRead"))) await api.setRead([book.id], true);
    }
    onClose();
  }

  updateSettings();
}
