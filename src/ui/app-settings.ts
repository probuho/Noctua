import { t } from "../i18n";
import { h } from "./dom";
import { icon } from "./icons";
import { getMode, setMode, type Mode } from "./mode";
import { openSupportDialog } from "./support-dialog";

const SOUND_KEY = "sound-on-finish";

/** Whether long tasks (like importing a folder) play a chime when they finish. */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function setSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* this session only */
  }
}

/** App-wide preferences (the gear in the top bar). */
export function openAppSettings(): void {
  const radio = (value: Mode, label: string) =>
    h(
      "label",
      { class: "choice" },
      h("input", { type: "radio", name: "app-mode", value, checked: getMode() === value, onchange: () => setMode(value) }),
      h("span", {}, h("strong", {}, label)),
    );
  const sound = h("input", { type: "checkbox", checked: soundEnabled(), onchange: (e: Event) => setSound((e.target as HTMLInputElement).checked) });
  const dialog = h(
    "dialog",
    { class: "modal app-settings", "aria-labelledby": "app-settings-title" },
    h(
      "form",
      { method: "dialog" },
      h("h2", { id: "app-settings-title" }, t("appSettings")),
      h("fieldset", { class: "choices" }, h("legend", {}, t("appearance")), radio("night", t("modeNight")), radio("day", t("modeDay"))),
      h("label", { class: "check-row" }, sound, t("soundOnFinish")),
      h("p", { class: "muted" }, t("windowTips")),
      h(
        "div",
        { class: "modal-actions" },
        h("button", { type: "button", onclick: () => openSupportDialog() }, icon("coffee"), h("span", {}, t("supportTitle"))),
        h("button", { value: "close", class: "primary" }, t("close")),
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
