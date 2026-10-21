import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type Book } from "../../api";
import type { ReaderSession, ReadingPosition } from "../../formats";
import { t } from "../../i18n";
import { h } from "../dom";
import { openExternal } from "../external";
import { icon } from "../icons";
import { positionMarker, renderMarkdown } from "../markdown";
import { externalLinkDialog } from "../secure-dialogs";

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const dateTime = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" });

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

interface Deps {
  book: Book;
  session: ReaderSession;
  position: () => ReadingPosition | null;
}

/**
 * Reading journal: free writing about the book, kept as one Markdown file per
 * book in a folder the user owns (it can be an Obsidian vault). Unlike notes,
 * it accepts pasted images, saved next to the file in attachments/.
 */
export function createJournalView({ book, session, position }: Deps) {
  let folder: string | null = null;
  let file = "";
  let contents = "";
  let blobUrls: string[] = [];

  const el = h("div", { class: "journal" });
  const status = h("p", { class: "muted journal-status", role: "status" });
  const preview = h("div", { class: "md-preview", "aria-live": "polite" });
  const input = h("textarea", { rows: 5, placeholder: t("journalPlaceholder"), "aria-label": t("journal") }) as HTMLTextAreaElement;
  const linkInput = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;

  const fail = (err: unknown) => (status.textContent = String(err));

  // --- Images ---------------------------------------------------------------
  const insertAtCursor = (area: HTMLTextAreaElement, text: string) => {
    const { selectionStart: s, selectionEnd: e, value } = area;
    const before = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
    area.value = value.slice(0, s) + before + text + "\n" + value.slice(e);
    area.selectionStart = area.selectionEnd = s + before.length + text.length + 1;
    area.focus();
  };

  const saveImages = async (area: HTMLTextAreaElement, files: File[]) => {
    for (const f of files) {
      const ext = IMAGE_TYPES[f.type];
      if (!ext) {
        status.textContent = t("journalImageType");
        continue;
      }
      try {
        const rel = await api.journalSaveImage(toBase64(new Uint8Array(await f.arrayBuffer())), ext);
        insertAtCursor(area, `![](${encodeURI(rel)})`);
        status.textContent = t("journalImageSaved");
      } catch (err) {
        fail(err);
      }
    }
  };

  /** Paste and drop of images into a textarea. */
  const acceptImages = (area: HTMLTextAreaElement) => {
    area.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void saveImages(area, files);
    });
    area.addEventListener("dragover", (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.type.startsWith("image/"))) e.preventDefault();
    });
    area.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void saveImages(area, files);
    });
  };

  const imageButton = (area: HTMLTextAreaElement) => {
    const picker = h("input", { type: "file", accept: Object.keys(IMAGE_TYPES).join(","), multiple: true, hidden: true }) as HTMLInputElement;
    picker.addEventListener("change", () => {
      void saveImages(area, [...(picker.files ?? [])]);
      picker.value = "";
    });
    return h("button", { type: "button", onclick: () => picker.click() }, icon("image"), h("span", {}, t("insertImage")), picker);
  };

  // --- Preview --------------------------------------------------------------
  const hooks = {
    image: (src: string, img: HTMLImageElement) => {
      api
        .journalImage(src)
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes]));
          blobUrls.push(url);
          img.src = url;
        })
        .catch(() => img.replaceWith(h("span", { class: "md-missing" }, `${t("journalImageMissing")}: ${src}`)));
    },
    link: async (url: string) => {
      if (await externalLinkDialog(url)) await openExternal(url);
    },
    position: (location: string) => void session.goTo(location),
    positionLabel: t("goToSavedPosition"),
  };

  const drawPreview = () => {
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    blobUrls = [];
    const rendered = renderMarkdown(contents, hooks);
    // Only the title heading means the file has no entries yet.
    preview.replaceChildren(rendered.childNodes.length > 1 ? rendered : h("p", { class: "empty" }, t("noJournal")));
    preview.querySelectorAll(".md-position").forEach((b) => b.prepend(icon("pin")));
  };

  // --- Views ----------------------------------------------------------------
  const chooseFolder = async () => {
    const picked = await openDialog({ directory: true, title: t("journalChooseFolder") });
    if (typeof picked !== "string") return;
    try {
      await api.setJournalFolder(picked);
      await load();
    } catch (err) {
      fail(err);
    }
  };

  const reveal = async () => {
    if (!folder) return;
    const sep = folder.includes("\\") ? "\\" : "/";
    try {
      await revealItemInDir(contents ? `${folder.replace(/[\\/]$/, "")}${sep}${file}` : folder);
    } catch (err) {
      fail(err);
    }
  };

  const setupView = () =>
    el.replaceChildren(
      h(
        "div",
        { class: "journal-setup" },
        h("p", {}, t("journalSetupIntro")),
        h("p", { class: "muted" }, t("journalSetupHint")),
        h("button", { type: "button", class: "primary", onclick: chooseFolder }, icon("folder"), h("span", {}, t("journalChooseFolder"))),
        status,
      ),
    );

  const toolbar = () =>
    h(
      "div",
      { class: "panel-actions journal-toolbar" },
      h("span", { class: "journal-file muted", title: `${folder}` }, icon("file"), h("span", {}, file)),
      h("button", { type: "button", onclick: editView }, icon("edit"), h("span", {}, t("journalEditFile"))),
      h("button", { type: "button", onclick: reveal, title: t("journalShowFolder"), "aria-label": t("journalShowFolder") }, icon("folder")),
      h("button", { type: "button", onclick: chooseFolder }, t("journalChangeFolder")),
    );

  const mainView = () => {
    const form = h(
      "form",
      {
        class: "journal-form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return input.focus();
          const pos = linkInput.checked ? position() : null;
          const heading = `## ${dateTime.format(new Date())}${pos ? ` · ${Math.round(pos.progress * 100)} %` : ""}`;
          const section = [heading, "", text, ...(pos ? ["", positionMarker(pos.location)] : [])].join("\n");
          try {
            contents = await api.journalAppend(book.id, section);
            input.value = "";
            status.textContent = t("journalSaved");
            drawPreview();
          } catch (err) {
            fail(err);
          }
        },
      },
      input,
      h("p", { class: "muted journal-hint" }, t("journalPasteHint")),
      h(
        "div",
        { class: "journal-form-row" },
        h("label", { class: "check-row" }, linkInput, t("linkPosition")),
        imageButton(input),
        h("button", { type: "submit", class: "primary" }, t("addEntry")),
      ),
    );
    el.replaceChildren(toolbar(), form, status, preview);
    drawPreview();
  };

  function editView() {
    const editor = h("textarea", { class: "journal-editor", rows: 18, "aria-label": t("journalEditFile") }) as HTMLTextAreaElement;
    editor.value = contents;
    acceptImages(editor);
    el.replaceChildren(
      h(
        "form",
        {
          class: "journal-form",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              await api.journalWrite(book.id, editor.value);
              contents = editor.value;
              status.textContent = t("journalSaved");
              mainView();
            } catch (err) {
              fail(err);
            }
          },
        },
        h("p", { class: "muted" }, t("journalEditHint")),
        editor,
        h(
          "div",
          { class: "journal-form-row" },
          imageButton(editor),
          h("button", { type: "button", onclick: mainView }, t("cancel")),
          h("button", { type: "submit", class: "primary" }, t("save")),
        ),
        status,
      ),
    );
    editor.focus();
  }

  async function load() {
    try {
      const data = await api.journalRead(book.id);
      folder = data.folder;
      file = data.file;
      contents = data.contents;
      status.textContent = "";
      if (folder) mainView();
      else setupView();
    } catch (err) {
      setupView();
      fail(err);
    }
  }

  acceptImages(input);
  void load();

  return {
    el,
    focus: () => (el.querySelector("textarea, button") as HTMLElement | null)?.focus(),
    destroy: () => blobUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
