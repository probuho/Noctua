import { ask, message } from "@tauri-apps/plugin-dialog";
import { t } from "../i18n";
import { h } from "./dom";

// window.confirm/alert are unreliable in WKWebView (macOS/iOS): use native dialogs.
export async function confirmDialog(text: string, okLabel?: string): Promise<boolean> {
  return ask(text, { title: t("appName"), kind: "warning", okLabel, cancelLabel: t("cancel") });
}

export async function alertDialog(text: string): Promise<void> {
  await message(text, { title: t("appName") });
}

/** Small modal with one text field; resolves to the trimmed value or null. */
export function promptDialog(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", value: initial, "aria-label": title });
    const dialog = h(
      "dialog",
      { class: "modal" },
      h(
        "form",
        { method: "dialog" },
        h("h2", {}, title),
        input,
        h(
          "div",
          { class: "modal-actions" },
          // type="button": Enter in the field must submit "OK", not "Cancel".
          h("button", { type: "button", onclick: (e: Event) => (e.target as HTMLElement).closest("dialog")!.close("cancel") }, t("cancel")),
          h("button", { value: "ok", class: "primary" }, t("ok")),
        ),
      ),
    );
    dialog.addEventListener("close", () => {
      const value = input.value.trim();
      dialog.remove();
      resolve(dialog.returnValue === "ok" && value ? value : null);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}
