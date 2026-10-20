import { api, loadBookFile, type Book } from "../../api";
import { getFormat, PasswordCancelledError, type PageLayout, type ReaderSession, type ReadingPosition } from "../../formats";
import { t } from "../../i18n";
import { confirmDialog } from "../dialogs";
import { h } from "../dom";
import { openExternal } from "../external";
import { isFullscreen, setFullscreen, toggleFullscreen } from "../fullscreen";
import { icon, setIcon, type IconName } from "../icons";
import { externalLinkDialog, passwordDialog } from "../secure-dialogs";
import { openSupportDialog } from "../support-dialog";
import { applyAppTheme, DEFAULT_SETTINGS, loadSettings, saveSettings, THEMES } from "../theme";
import { createAnnotator, loadLabels, saveLabels } from "./annotations";
import { actionFor, hotkeySheet, type Action } from "./hotkeys";
import { createSettingsPanel, radios, SETTINGS_ID } from "./settings-panel";
import { createSidePanel, PANEL_ID, PANEL_TABS, type PanelTab } from "./side-panel";

const SAVE_DELAY_MS = 800;
const SLIDER_STEPS = 1000;
const HELP_ID = "reader-help-panel";

/**
 * Passwords typed this session, so reopening a protected book does not ask
 * again. Kept in memory only: never written to disk or the library.
 */
const sessionPasswords = new Map<number, string>();

/** Toolbar button with an icon and a text label (hidden visually on narrow windows). */
function toolButton(name: IconName, label: string, onclick: () => void, attrs: Record<string, string> = {}) {
  return h(
    "button",
    { class: "tool-button", title: label, onclick, ...attrs },
    icon(name),
    h("span", { class: "tool-label" }, label),
  );
}

/**
 * Opens `book` where the reader left off. With `jumpTo` (a note, bookmark or
 * journal position) it then jumps there, so "Back" returns to the last read spot.
 */
export async function renderReader(root: HTMLElement, book: Book, onClose: () => void, jumpTo?: string): Promise<void> {
  const settings = loadSettings();
  applyAppTheme(settings.theme);

  const stage = h("main", { class: "reader-stage", "aria-label": book.title });
  const dim = h("div", { class: "dim", "aria-hidden": "true" });
  const loading = h("p", { class: "empty" }, "…");
  stage.append(loading);

  // Mount the final layout before opening the book: moving the stage in the
  // DOM afterwards would reload the book's iframes and blank the page.
  const body = h("div", { class: "reader-body" }, stage);
  const placeholderBar = h(
    "header",
    { class: "toolbar reader-toolbar" },
    toolButton("back", t("back"), onClose),
    h("span", { class: "reader-title" }, book.title),
  );
  const placeholderRail = h("nav", { class: "activity-rail" });
  const placeholderNav = h("footer", { class: "reader-nav" });
  root.replaceChildren(
    h("div", { class: "reader" }, placeholderBar, h("div", { class: "reader-main" }, placeholderRail, body), placeholderNav),
  );

  let session: ReaderSession;
  try {
    const file = await loadBookFile(book);
    let typed: string | null = null;
    const remembered = sessionPasswords.get(book.id);
    session = await getFormat(book.format).open(stage, file, {
      location: book.location,
      settings,
      labels: { page: (n) => t("goToPageLink", String(n)), web: (host) => t("webLink", host) },
      requestPassword: async (retry) => {
        // Try the remembered password once before asking.
        if (!retry && remembered && typed === null) return (typed = remembered);
        typed = await passwordDialog(book.title, retry && typed !== null);
        return typed;
      },
    });
    if (typed) sessionPasswords.set(book.id, typed);
    loading.remove();
  } catch (err) {
    if (err instanceof PasswordCancelledError) {
      sessionPasswords.delete(book.id);
      loading.replaceWith(
        h(
          "div",
          { class: "empty locked" },
          icon("lock"),
          h("p", {}, t("passwordRequired")),
          h("button", { class: "primary", onclick: () => void renderReader(root, book, onClose, jumpTo) }, t("unlock")),
          h("button", { onclick: onClose }, t("back")),
        ),
      );
    } else {
      loading.textContent = t("openError", String(err));
    }
    return;
  }
  stage.append(dim);

  // Mouse paging: click the side margins or use the wheel (paged views only;
  // the continuous view scrolls natively).
  const zone = (side: "prev" | "next") =>
    h(
      "button",
      {
        class: `page-zone page-zone-${side}`,
        "aria-label": side === "prev" ? t("prev") : t("next"),
        title: side === "prev" ? t("prev") : t("next"),
        tabindex: -1, // keyboard users have arrows and the footer buttons
        onclick: () => void (side === "prev" ? session.prev() : session.next()),
      },
      icon(side),
    );
  stage.append(zone("prev"), zone("next"));
  let wheelAt = 0;
  stage.addEventListener(
    "wheel",
    (e) => {
      if (settings.layout === "scroll" || Math.abs(e.deltaY) < 4) return;
      const pdfScroll = (e.target as HTMLElement).closest?.(".pdf-view");
      // Let a zoomed PDF page scroll until it reaches its edge.
      if (pdfScroll && pdfScroll.scrollHeight > pdfScroll.clientHeight + 2) {
        const atEnd = pdfScroll.scrollTop + pdfScroll.clientHeight >= pdfScroll.scrollHeight - 2;
        const atStart = pdfScroll.scrollTop <= 0;
        if ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atStart)) return;
      }
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 350) return;
      wheelAt = now;
      void (e.deltaY > 0 ? session.next() : session.prev());
    },
    { passive: false },
  );

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

  const updateSettings = () => {
    stage.dataset.layout = settings.layout;
    saveSettings(settings);
    applyAppTheme(settings.theme);
    dim.style.opacity = String(settings.dimming);
    session.applySettings(settings);
    syncViewSwitch();
    if (flipTimer) startAutoFlip();
  };

  // --- Panels -----------------------------------------------------------------
  const labels = session.capabilities.annotations ? await loadLabels() : null;
  const annotator = labels
    ? createAnnotator({ bookId: book.id, session, labels, searchInBook: (query) => side.search(query) })
    : null;
  const side = createSidePanel({ book, session, annotator, position: () => position });

  session.onExternalLink(async (url) => {
    if (await externalLinkDialog(url)) await openExternal(url);
  });

  const help = h(
    "section",
    { id: HELP_ID, class: "settings-panel help-panel", role: "dialog", "aria-labelledby": `${HELP_ID}-title`, hidden: true },
    h(
      "header",
      { class: "panel-header" },
      h("h2", { id: `${HELP_ID}-title` }, t("hotkeys")),
      h("button", { class: "icon-action", "aria-label": t("close"), title: t("close"), onclick: () => closeHelp() }, icon("close")),
    ),
    hotkeySheet(),
    h("button", { class: "support-button", onclick: () => openSupportDialog() }, icon("heart"), h("span", {}, t("supportTitle"))),
  );

  // The settings panel is rebuilt on every open so it always shows current values.
  const makeSettings = () =>
    createSettingsPanel({
      settings,
      caps: session.capabilities,
      labels,
      onChange: updateSettings,
      onLabels: (next) => {
        annotator?.setLabels(next);
        void saveLabels(next);
      },
      onClose: () => closeSettings(),
    });
  let settingsPanel = makeSettings();

  // --- Toolbar --------------------------------------------------------------
  const positionLabel = h("span", { class: "position" });
  const settingsButton = toolButton("text", t("settingsShort"), () => toggleSettings(), {
    "aria-expanded": "false",
    "aria-controls": SETTINGS_ID,
  });
  const helpButton = toolButton("help", t("helpShort"), () => toggleHelp(), { "aria-expanded": "false", "aria-controls": HELP_ID });
  const flipButton = toolButton("play", t("autoShort"), () => toggleAutoFlip(), { "aria-pressed": "false" });
  flipButton.title = t("autoFlipStart");

  const viewHolder = h("div", { class: "view-switch", role: "group", "aria-label": t("viewMode") });
  const syncViewSwitch = () =>
    viewHolder.replaceChildren(
      radios<PageLayout>(
        "view-mode",
        [
          { value: "single", label: t("viewSingle"), icon: icon("single") },
          { value: "double", label: t("viewDouble"), icon: icon("double") },
          { value: "scroll", label: t("viewScroll"), icon: icon("scroll") },
        ],
        settings.layout,
        (value) => {
          settings.layout = value;
          updateSettings();
          viewHolder.querySelector<HTMLInputElement>(`input[value="${value}"]`)?.focus();
        },
      ),
    );
  syncViewSwitch();

  const toolbar = h(
    "header",
    { class: "toolbar reader-toolbar" },
    toolButton("back", t("back"), () => void close()),
    h("div", { class: "reader-heading" }, h("span", { class: "reader-title" }, book.title), positionLabel),
    viewHolder,
    settingsButton,
    flipButton,
    toolButton("fullscreen", t("fullscreenShort"), () => void toggleFullscreen()),
    helpButton,
  );

  // --- Activity rail: one button per side panel, icon + visible label ---------
  const railButtons = new Map<PanelTab, HTMLButtonElement>();
  const rail = h(
    "nav",
    { class: "activity-rail", "aria-label": t("readerTools") },
    ...PANEL_TABS.filter((tab) => side.has(tab.id)).map((tab) => {
      const button = h(
        "button",
        {
          class: "rail-button",
          "aria-expanded": "false",
          "aria-controls": PANEL_ID,
          onclick: () => side.toggle(tab.id),
        },
        icon(tab.icon),
        h("span", {}, t(tab.label)),
      );
      railButtons.set(tab.id, button);
      return button;
    }),
  );
  side.onChange((open) => railButtons.forEach((button, id) => button.setAttribute("aria-expanded", String(open === id))));

  // --- Footer: navigation, progress slider, go to page ------------------------
  const footerButton = (name: IconName, label: string, onclick: () => void, attrs: Record<string, string | boolean> = {}) =>
    h("button", { class: "tool-button", title: label, onclick, ...attrs }, icon(name), h("span", { class: "tool-label" }, label));
  const backButton = footerButton("undo", t("goBack"), () => void session.back(), { disabled: true });
  const sliderId = "reader-progress";
  const slider = h("input", { id: sliderId, type: "range", class: "progress-slider", min: 0, max: SLIDER_STEPS, value: 0 });
  slider.addEventListener("input", () => {
    sliderDragging = true;
    const text = `${Math.round((Number(slider.value) / SLIDER_STEPS) * 100)}%`;
    positionLabel.textContent = text;
    slider.setAttribute("aria-valuetext", text);
  });
  slider.addEventListener("change", () => {
    sliderDragging = false;
    void session.goToFraction(Number(slider.value) / SLIDER_STEPS);
  });

  const pageInput = h("input", { id: "reader-page", type: "number", class: "narrow", min: 1 });
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
        h("label", { for: "reader-page" }, t("page")),
        pageInput,
        pageTotal,
      )
    : null;

  const nav = h(
    "footer",
    { class: "reader-nav" },
    footerButton("prev", t("prev"), () => void session.prev()),
    backButton,
    h("label", { for: sliderId, class: "visually-hidden" }, t("progress")),
    slider,
    pageForm,
    footerButton("next", t("next"), () => void session.next()),
  );

  body.prepend(side.el);
  body.append(settingsPanel.el, help);
  if (annotator) body.append(annotator.popup);
  placeholderBar.replaceWith(toolbar);
  placeholderRail.replaceWith(rail);
  placeholderNav.replaceWith(nav);

  // --- Floating panels: settings and help -------------------------------------
  function toggleSettings() {
    if (settingsPanel.isOpen()) return closeSettings();
    closeHelp(false);
    const fresh = makeSettings();
    settingsPanel.el.replaceWith(fresh.el);
    settingsPanel = fresh;
    settingsPanel.open();
    settingsButton.setAttribute("aria-expanded", "true");
  }
  function closeSettings(restoreFocus = true) {
    if (!settingsPanel.isOpen()) return;
    settingsPanel.close();
    settingsButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) settingsButton.focus();
  }
  function toggleHelp() {
    if (!help.hidden) return closeHelp();
    closeSettings(false);
    help.hidden = false;
    helpButton.setAttribute("aria-expanded", "true");
    help.querySelector<HTMLElement>("button")?.focus();
  }
  function closeHelp(restoreFocus = true) {
    if (help.hidden) return;
    help.hidden = true;
    helpButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) helpButton.focus();
  }

  // --- Relocation -------------------------------------------------------------
  session.onRelocate((pos) => {
    position = pos;
    const pct = `${Math.round(pos.progress * 100)}%`;
    positionLabel.textContent = pos.label ? `${pos.label} · ${pct}` : pct;
    if (!sliderDragging) {
      slider.value = String(Math.round(pos.progress * SLIDER_STEPS));
      slider.setAttribute("aria-valuetext", pct);
    }
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
    setIcon(flipButton, on ? "pause" : "play");
    flipButton.title = on ? t("autoFlipStop") : t("autoFlipStart");
    flipButton.setAttribute("aria-pressed", String(on));
  }

  // --- Hotkeys ----------------------------------------------------------------
  /** Closes the topmost floating thing; returns false when nothing was open. */
  const closeOverlays = (): boolean => {
    if (annotator?.isOpen()) {
      annotator.hide();
      session.clearSelection();
      return true;
    }
    if (settingsPanel.isOpen()) return closeSettings(), true;
    if (!help.hidden) return closeHelp(), true;
    const tab = side.current();
    if (tab) {
      side.close();
      railButtons.get(tab)?.focus();
      return true;
    }
    return false;
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
    journal: () => side.toggle("journal"),
    larger: () => {
      settings.fontSize = Math.min(300, settings.fontSize + 10);
      updateSettings();
    },
    smaller: () => {
      settings.fontSize = Math.max(50, settings.fontSize - 10);
      updateSettings();
    },
    resetSize: () => {
      settings.fontSize = DEFAULT_SETTINGS.fontSize;
      updateSettings();
    },
    fullscreen: () => void toggleFullscreen(),
    back: () => session.back(),
    theme: () => {
      settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
      updateSettings();
    },
    layout: () => {
      const order: PageLayout[] = ["single", "double", "scroll"];
      settings.layout = order[(order.indexOf(settings.layout) + 1) % order.length];
      updateSettings();
    },
    help: () => toggleHelp(),
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
    closeSettings(false);
    closeHelp(false);
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
  if (jumpTo) await session.goTo(jumpTo);
}
