import { api, type Book } from "../../api";
import { t } from "../../i18n";
import { alertDialog } from "../dialogs";
import { blobToThumbnail, h } from "../dom";
import { createOnlineLookup } from "./online-metadata";

const dateFormat = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" });

export function formatDate(seconds: number | null): string {
  return seconds ? dateFormat.format(new Date(seconds * 1000)) : t("never");
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

/** How the user wants files kept in order (remembered between edits). */
const ORGANIZE_KEY = "organize-files";
type Organize = { rename: boolean; write: boolean };

/** Mirrors book_files::organized_name in Rust, for the preview only. */
function organizedName(title: string, author: string, ext: string): string {
  const clean = (s: string, max: number) =>
    s.replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "").slice(0, max).trim();
  const ti = clean(title, 150);
  const a = clean(author, 80);
  return ti ? `${a ? `${a} - ` : ""}${ti}.${ext}` : "";
}

function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

/** Modal to edit title, author, description and cover. Resolves when closed. */
export async function openProperties(initial: Book): Promise<void> {
  const organize: Organize = { rename: true, write: true, ...((await api.getSetting<Organize>(ORGANIZE_KEY)) ?? {}) };
  return new Promise((resolve) => {
    let book = initial;

    const coverBox = h("div", { class: "properties-cover" });
    const resetButton = h("button", { type: "button" }, t("resetCover"));
    const drawCover = () => {
      coverBox.replaceChildren(
        book.cover
          ? h("img", { class: "cover", src: book.cover, alt: "" })
          : h("div", { class: "cover placeholder" }, book.format.toUpperCase()),
      );
      resetButton.hidden = !book.hasOriginalCover;
    };

    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        book = await api.setCover(book.id, await blobToThumbnail(file));
        drawCover();
      } catch {
        await alertDialog(t("invalidImage"));
      } finally {
        fileInput.value = "";
      }
    });
    resetButton.addEventListener("click", async () => {
      book = await api.resetCover(book.id);
      drawCover();
    });

    const title = h("input", { type: "text", name: "title", value: book.title, required: true });
    const author = h("input", { type: "text", name: "author", value: book.author ?? "" });
    const description = h("textarea", { name: "description", rows: 4 });
    description.value = book.description ?? "";

    const lookup = createOnlineLookup({
      query: () => ({ title: title.value, author: author.value.trim() || null }),
      useData: (data) => {
        title.value = data.title;
        author.value = data.author ?? "";
        if (data.description) description.value = data.description;
      },
      useCover: async (image) => {
        book = await api.setCover(book.id, await blobToThumbnail(image));
        drawCover();
      },
    });

    // Keeping files in order: rename after the details and write them inside the file.
    const ext = book.path.split(".").pop() ?? book.format;
    const currentName = book.path.split(/[\\/]/).pop() ?? "";
    const renameBox = h("input", { type: "checkbox", checked: organize.rename }) as HTMLInputElement;
    const writeBox = h("input", { type: "checkbox", checked: organize.write }) as HTMLInputElement;
    const namePreview = h("span", { class: "muted name-preview" });
    const drawNamePreview = () => {
      const next = organizedName(title.value, author.value, ext);
      namePreview.textContent = !renameBox.checked || !next || next === currentName ? t("fileNameStays", currentName) : t("fileNameWillBe", next);
    };
    [title, author].forEach((el) => el.addEventListener("input", drawNamePreview));
    renameBox.addEventListener("change", drawNamePreview);
    const organizeFields = h(
      "fieldset",
      { class: "organize" },
      h("legend", {}, t("organizeFiles")),
      h("label", { class: "check-row" }, renameBox, t("renameFile")),
      namePreview,
      book.format === "epub" ? h("label", { class: "check-row" }, writeBox, t("writeToFile")) : h("p", { class: "muted" }, t("writeToFileEpubOnly")),
    );
    drawNamePreview();

    const field = (label: string, control: HTMLElement) => h("label", { class: "field" }, h("span", {}, label), control);
    const info = (label: string, value: string) => [h("dt", {}, label), h("dd", {}, value)];

    const dialog = h(
      "dialog",
      { class: "modal properties" },
      h(
        "form",
        { method: "dialog" },
        h("h2", {}, t("properties")),
        h(
          "div",
          { class: "properties-grid" },
          h(
            "div",
            { class: "properties-side" },
            coverBox,
            h("button", { type: "button", onclick: () => fileInput.click() }, t("changeCover")),
            resetButton,
            fileInput,
          ),
          h(
            "div",
            { class: "properties-fields" },
            field(t("title"), title),
            field(t("author"), author),
            field(t("description"), description),
            organizeFields,
            h(
              "dl",
              { class: "properties-info" },
              ...info(t("format"), book.format.toUpperCase()),
              ...info(t("fileSize"), formatSize(book.size)),
              ...info(t("progress"), `${Math.round(book.progress * 100)}%`),
              ...info(t("notes"), String(book.annotationCount)),
              ...info(t("added"), formatDate(book.addedAt)),
              ...info(t("lastOpened"), formatDate(book.lastOpened)),
              ...info(t("folder"), folderOf(book.path)),
            ),
          ),
        ),
        lookup.el,
        h(
          "div",
          { class: "modal-actions" },
          // type="button": Enter in a field must submit "Save", not "Cancel".
          h("button", { type: "button", onclick: (e: Event) => (e.target as HTMLElement).closest("dialog")!.close("cancel") }, t("cancel")),
          h("button", { value: "save", class: "primary" }, t("save")),
        ),
      ),
    );

    dialog.addEventListener("close", async () => {
      if (dialog.returnValue === "save") {
        const choice: Organize = { rename: renameBox.checked, write: writeBox.checked };
        await api.setSetting(ORGANIZE_KEY, choice);
        try {
          const saved = await api.updateProperties(book.id, {
            title: title.value,
            author: author.value.trim() || null,
            description: description.value.trim() || null,
            renameFile: choice.rename,
            writeToFile: choice.write && book.format === "epub",
          });
          if (saved.warnings.length) await alertDialog(`${t("organizeWarnings")}\n\n${saved.warnings.join("\n")}`);
        } catch (err) {
          await alertDialog(String(err));
        }
      }
      lookup.destroy();
      dialog.remove();
      resolve();
    });

    drawCover();
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
  });
}
