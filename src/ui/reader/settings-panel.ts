import type { Capabilities, FontFamily, PageLayout, PdfFit, ReaderSettings, TextAlign } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";
import { THEMES } from "../theme";

const LINE_HEIGHT = { min: 1, max: 2.4, step: 0.1 };
const SIZE = { min: 50, max: 300, step: 10 };

function row(label: string, ...controls: Node[]): HTMLElement {
  return h("div", { class: "setting" }, h("span", { class: "setting-label" }, label), h("div", { class: "setting-controls" }, ...controls));
}

function segmented<T extends string>(
  options: Array<[T, string]>,
  current: () => T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = h("div", { class: "segmented", role: "group" });
  const draw = () =>
    group.replaceChildren(
      ...options.map(([value, label]) =>
        h(
          "button",
          {
            "aria-pressed": String(current() === value),
            onclick: () => {
              onPick(value);
              draw();
            },
          },
          label,
        ),
      ),
    );
  draw();
  return group;
}

/** Popover with all reading settings; calls `onChange` after every edit. */
export function createSettingsPanel(settings: ReaderSettings, caps: Capabilities, onChange: () => void) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    settings[key] = value;
    onChange();
  };

  const sizeValue = h("output", {}, `${settings.fontSize}%`);
  const stepSize = (delta: number) => {
    set("fontSize", Math.min(SIZE.max, Math.max(SIZE.min, settings.fontSize + delta)));
    sizeValue.textContent = `${settings.fontSize}%`;
  };

  const lineValue = h("output", {}, settings.lineHeight.toFixed(1));
  const stepLine = (delta: number) => {
    const next = Math.round((settings.lineHeight + delta) * 10) / 10;
    set("lineHeight", Math.min(LINE_HEIGHT.max, Math.max(LINE_HEIGHT.min, next)));
    lineValue.textContent = settings.lineHeight.toFixed(1);
  };

  const themeButtons = THEMES.map((theme) =>
    h("button", {
      class: `swatch swatch-${theme}`,
      title: t(theme),
      "aria-label": t(theme),
      "aria-pressed": String(settings.theme === theme),
      onclick: () => {
        set("theme", theme);
        themeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(THEMES[i] === theme)));
      },
    }),
  );

  const el = h(
    "section",
    { class: "settings-panel", hidden: true, "aria-label": t("settings") },
    h("h2", {}, t("settings")),
    row(t("theme"), ...themeButtons),
    row(
      t("dimming"),
      h("input", {
        type: "range",
        min: 0,
        max: 0.7,
        step: 0.05,
        value: settings.dimming,
        "aria-label": t("dimming"),
        oninput: (e: Event) => set("dimming", Number((e.target as HTMLInputElement).value)),
      }),
    ),
    row(
      caps.reflowable ? t("size") : t("zoom"),
      h("button", { class: "icon", "aria-label": t("smaller"), onclick: () => stepSize(-SIZE.step) }, "−"),
      sizeValue,
      h("button", { class: "icon", "aria-label": t("larger"), onclick: () => stepSize(SIZE.step) }, "+"),
    ),
    caps.reflowable &&
      row(
        t("font"),
        h(
          "select",
          {
            "aria-label": t("font"),
            onchange: (e: Event) => set("fontFamily", (e.target as HTMLSelectElement).value as FontFamily),
          },
          ...(
            [
              ["original", t("fontOriginal")],
              ["serif", t("fontSerif")],
              ["sans", t("fontSans")],
              ["mono", t("fontMono")],
            ] as Array<[FontFamily, string]>
          ).map(([value, label]) => h("option", { value, selected: settings.fontFamily === value }, label)),
        ),
      ),
    caps.reflowable &&
      row(
        t("lineHeight"),
        h("button", { class: "icon", "aria-label": "−", onclick: () => stepLine(-LINE_HEIGHT.step) }, "−"),
        lineValue,
        h("button", { class: "icon", "aria-label": "+", onclick: () => stepLine(LINE_HEIGHT.step) }, "+"),
      ),
    caps.reflowable &&
      row(
        t("align"),
        segmented<TextAlign>(
          [
            ["original", t("alignOriginal")],
            ["left", t("alignLeft")],
            ["justify", t("alignJustify")],
          ],
          () => settings.textAlign,
          (v) => set("textAlign", v),
        ),
      ),
    row(
      t("pageView"),
      segmented<PageLayout>(
        [
          ["single", t("singlePage")],
          ["double", t("doublePage")],
        ],
        () => settings.layout,
        (v) => set("layout", v),
      ),
    ),
    caps.fit &&
      row(
        t("fit"),
        segmented<PdfFit>(
          [
            ["page", t("fitPage")],
            ["width", t("fitWidth")],
          ],
          () => settings.pdfFit,
          (v) => set("pdfFit", v),
        ),
      ),
    row(
      t("autoFlip"),
      h("input", {
        type: "number",
        min: 3,
        max: 600,
        value: settings.autoFlipSeconds,
        class: "narrow",
        "aria-label": t("autoFlip"),
        onchange: (e: Event) => {
          const value = Math.min(600, Math.max(3, Number((e.target as HTMLInputElement).value) || 30));
          set("autoFlipSeconds", value);
        },
      }),
      h("span", { class: "muted" }, t("seconds")),
    ),
  );

  return {
    el,
    isOpen: () => !el.hidden,
    toggle: () => (el.hidden = !el.hidden),
    close: () => (el.hidden = true),
    /** Keeps the size readout in sync when changed from a hotkey. */
    stepSize,
  };
}
