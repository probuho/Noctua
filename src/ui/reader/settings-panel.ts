import type { Capabilities, FontFamily, PdfFit, ReaderSettings, TextAlign, Theme } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";
import { icon } from "../icons";
import { THEMES } from "../theme";
import { COLOR_NAMES, HIGHLIGHT_COLORS, type Labels } from "./annotations";

const LINE_HEIGHT = { min: 1, max: 2.4, step: 0.1 };
const SIZE = { min: 50, max: 300, step: 10 };
export const SETTINGS_ID = "reader-settings-panel";

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

/** A titled group of controls (fieldset + legend, announced as a group). */
function group(legend: string, ...controls: Array<Node | null | false>): HTMLFieldSetElement {
  return h("fieldset", { class: "setting" }, h("legend", {}, legend), h("div", { class: "setting-controls" }, ...controls));
}

/**
 * Native radio buttons styled as a segmented control: arrow keys, focus and
 * screen-reader announcements work out of the box.
 */
export function radios<T extends string>(
  name: string,
  options: Array<{ value: T; label: string; swatch?: string; icon?: Node }>,
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  return h(
    "div",
    { class: "segmented", role: "radiogroup" },
    ...options.map((o) => {
      const id = nextId(name);
      const input = h("input", {
        type: "radio",
        id,
        name,
        value: o.value,
        checked: o.value === current,
        onchange: () => onPick(o.value),
      });
      return h(
        "span",
        { class: "segment" },
        input,
        h(
          "label",
          { for: id },
          o.icon ?? null,
          o.swatch ? h("span", { class: "swatch", style: `--swatch:${o.swatch}`, "aria-hidden": "true" }) : null,
          h("span", {}, o.label),
        ),
      );
    }),
  );
}

/** − value + stepper with an announced value. */
function stepper(label: string, value: () => string, onStep: (direction: -1 | 1) => void) {
  const output = h("output", { "aria-live": "polite" }, value());
  const step = (direction: -1 | 1) => {
    onStep(direction);
    output.textContent = value();
  };
  return {
    el: h(
      "div",
      { class: "stepper" },
      h("button", { type: "button", "aria-label": `${label}: −`, onclick: () => step(-1) }, "−"),
      output,
      h("button", { type: "button", "aria-label": `${label}: +`, onclick: () => step(1) }, "+"),
    ),
    step,
  };
}

const SWATCH: Record<Theme, string> = { light: "#ffffff", sepia: "#f4ecd8", dark: "#1b1b1d", "night-sepia": "#2a2118" };

interface Options {
  settings: ReaderSettings;
  caps: Capabilities;
  labels: Labels | null;
  onChange: () => void;
  onLabels: (labels: Labels) => void;
  onClose: () => void;
}

/** Non-modal dialog with every reading setting. Rebuilt each time it opens. */
export function createSettingsPanel({ settings, caps, labels, onChange, onLabels, onClose }: Options) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    settings[key] = value;
    onChange();
  };

  const size = stepper(
    caps.reflowable ? t("textSize") : t("zoom"),
    () => `${settings.fontSize}%`,
    (d) => set("fontSize", Math.min(SIZE.max, Math.max(SIZE.min, settings.fontSize + d * SIZE.step))),
  );
  const lineHeight = stepper(
    t("lineHeight"),
    () => settings.lineHeight.toFixed(1),
    (d) =>
      set("lineHeight", Math.min(LINE_HEIGHT.max, Math.max(LINE_HEIGHT.min, Math.round((settings.lineHeight + d * LINE_HEIGHT.step) * 10) / 10))),
  );

  const dimmingId = nextId("dimming");
  const dimmingOut = h("output", { for: dimmingId }, t("dimmingValue", String(Math.round(settings.dimming * 100))));
  const fontId = nextId("font");
  const flipId = nextId("flip");

  const titleId = `${SETTINGS_ID}-title`;
  const el = h(
    "section",
    { id: SETTINGS_ID, class: "settings-panel", role: "dialog", "aria-labelledby": titleId, hidden: true },
    h("header", { class: "panel-header" }, h("h2", { id: titleId }, t("settings")), h("button", { class: "icon-action", "aria-label": t("close"), title: t("close"), onclick: onClose }, icon("close"))),
    group(
      t("theme"),
      radios<Theme>(
        "theme",
        THEMES.map((theme) => ({ value: theme, label: t(theme), swatch: SWATCH[theme] })),
        settings.theme,
        (v) => set("theme", v),
      ),
    ),
    group(
      t("dimming"),
      h("input", {
        id: dimmingId,
        type: "range",
        min: 0,
        max: 0.7,
        step: 0.05,
        value: settings.dimming,
        "aria-label": t("dimming"),
        oninput: (e: Event) => {
          set("dimming", Number((e.target as HTMLInputElement).value));
          dimmingOut.textContent = t("dimmingValue", String(Math.round(settings.dimming * 100)));
          (e.target as HTMLInputElement).setAttribute("aria-valuetext", dimmingOut.textContent);
        },
      }),
      dimmingOut,
    ),
    group(caps.reflowable ? t("textSize") : t("zoom"), size.el),
    caps.reflowable &&
      group(
        t("font"),
        h("label", { class: "visually-hidden", for: fontId }, t("font")),
        h(
          "select",
          { id: fontId, onchange: (e: Event) => set("fontFamily", (e.target as HTMLSelectElement).value as FontFamily) },
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
    caps.reflowable && group(t("lineHeight"), lineHeight.el),
    caps.reflowable &&
      group(
        t("align"),
        radios<TextAlign>(
          "align",
          [
            { value: "original", label: t("alignOriginal") },
            { value: "left", label: t("alignLeft") },
            { value: "justify", label: t("alignJustify") },
          ],
          settings.textAlign,
          (v) => set("textAlign", v),
        ),
      ),
    caps.fit &&
      group(
        t("fit"),
        radios<PdfFit>(
          "fit",
          [
            { value: "page", label: t("fitPage") },
            { value: "width", label: t("fitWidth") },
          ],
          settings.pdfFit,
          (v) => set("pdfFit", v),
        ),
      ),
    group(
      t("autoFlip"),
      h("input", {
        id: flipId,
        type: "number",
        min: 3,
        max: 600,
        value: settings.autoFlipSeconds,
        class: "narrow",
        "aria-label": `${t("autoFlip")} (${t("seconds")})`,
        onchange: (e: Event) => {
          const value = Math.min(600, Math.max(3, Number((e.target as HTMLInputElement).value) || 30));
          set("autoFlipSeconds", value);
        },
      }),
      h("span", { class: "muted" }, t("seconds")),
    ),
    labels &&
      h(
        "fieldset",
        { class: "setting setting-block" },
        h("legend", {}, t("colorMeanings")),
        h("p", { class: "muted" }, t("colorMeaningsHint")),
        ...COLOR_NAMES.map((c) => {
          const id = nextId(`label-${c}`);
          return h(
            "div",
            { class: "meaning-row" },
            h("span", { class: "dot", style: `--dot:${HIGHLIGHT_COLORS[c].css}`, "aria-hidden": "true" }),
            h("label", { for: id, class: "visually-hidden" }, t("labelFor", t(HIGHLIGHT_COLORS[c].color))),
            h("input", {
              id,
              type: "text",
              maxlength: 30,
              value: labels[c],
              onchange: (e: Event) => {
                const value = (e.target as HTMLInputElement).value.trim();
                if (value) onLabels({ ...labels, [c]: value });
              },
            }),
          );
        }),
      ),
  );

  return {
    el,
    isOpen: () => !el.hidden,
    open: () => {
      el.hidden = false;
      // Start on the current theme, not on the close button.
      (el.querySelector<HTMLElement>("input:checked") ?? el.querySelector<HTMLElement>("input, select"))?.focus();
    },
    close: () => (el.hidden = true),
    /** Used by hotkeys so the readout stays in sync. */
    stepSize: (direction: -1 | 1) => size.step(direction),
  };
}
