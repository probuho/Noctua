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

/**
 * Asks how to delete books for good: only from the library, or also their
 * files (sent to the system trash, so they can still be recovered there).
 * Resolves to null when cancelled.
 */
export function deleteBooksDialog(count: number): Promise<{ deleteFiles: boolean } | null> {
  return new Promise((resolve) => {
    const option = (value: string, label: string, hint: string, checked: boolean) =>
      h(
        "label",
        { class: "choice" },
        h("input", { type: "radio", name: "delete-mode", value, checked }),
        h("span", {}, h("strong", {}, label), h("span", { class: "muted" }, hint)),
      );
    const dialog = h(
      "dialog",
      { class: "modal delete-modal", "aria-labelledby": "delete-title" },
      h(
        "form",
        { method: "dialog" },
        h("h2", { id: "delete-title" }, t("deleteTitle", String(count))),
        h(
          "fieldset",
          { class: "choices" },
          h("legend", {}, t("deleteHow")),
          option("files", t("deleteFiles"), t("deleteFilesHint"), true),
          option("library", t("deleteLibraryOnly"), t("deleteLibraryOnlyHint"), false),
        ),
        h(
          "div",
          { class: "modal-actions" },
          h("button", { type: "button", onclick: (e: Event) => (e.target as HTMLElement).closest("dialog")!.close("cancel") }, t("cancel")),
          h("button", { value: "ok", class: "primary danger-fill" }, t("deletePermanently")),
        ),
      ),
    );
    dialog.addEventListener("close", () => {
      const mode = dialog.querySelector<HTMLInputElement>("input[name=delete-mode]:checked")?.value;
      dialog.remove();
      resolve(dialog.returnValue === "ok" ? { deleteFiles: mode === "files" } : null);
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input:checked")?.focus();
  });
}
