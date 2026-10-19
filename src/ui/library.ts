import { open } from "@tauri-apps/plugin-dialog";
import { api, loadBookFile, type Book } from "../api";
import { getFormat } from "../formats";
import { t } from "../i18n";
import { blobToThumbnail, h } from "./dom";

/** Reads title, author and cover through the format plugin and stores them. */
async function enrichMetadata(book: Book): Promise<void> {
  try {
    const meta = await getFormat(book.format).extractMetadata(await loadBookFile(book));
    const cover = meta.cover ? await blobToThumbnail(meta.cover) : undefined;
    await api.updateMetadata(book.id, { title: meta.title, author: meta.author, cover });
  } catch (err) {
    console.warn(`Metadata extraction failed for ${book.path}`, err);
  }
}

function bookCard(book: Book, onOpen: (b: Book) => void, onRemove: (b: Book) => void): HTMLElement {
  const cover = book.cover
    ? h("img", { class: "cover", src: book.cover, alt: "" })
    : h("div", { class: "cover placeholder" }, book.format.toUpperCase());

  return h(
    "article",
    { class: "book-card" },
    h(
      "button",
      { class: "book-open", title: book.title, onclick: () => onOpen(book) },
      cover,
      h("span", { class: "book-title" }, book.title),
      h("span", { class: "book-author" }, book.author ?? t("unknownAuthor")),
      h(
        "span",
        { class: "progress", role: "progressbar", "aria-valuenow": Math.round(book.progress * 100) },
        h("span", { style: `width:${(book.progress * 100).toFixed(1)}%` }),
      ),
    ),
    h("button", { class: "book-remove icon", title: t("remove"), "aria-label": t("remove"), onclick: () => onRemove(book) }, "×"),
  );
}

export async function renderLibrary(root: HTMLElement, onOpen: (book: Book) => void): Promise<void> {
  const formats = await api.supportedFormats();
  let books = await api.listBooks();
  let query = "";

  const grid = h("section", { class: "book-grid" });
  const status = h("p", { class: "status", role: "status" });

  const refresh = async () => {
    books = await api.listBooks();
    draw();
  };

  const remove = async (book: Book) => {
    if (!confirm(t("confirmRemove", book.title))) return;
    await api.removeBook(book.id);
    await refresh();
  };

  const draw = () => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? books.filter((b) => `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q))
      : books;
    grid.replaceChildren(...visible.map((b) => bookCard(b, onOpen, remove)));
    if (!books.length) grid.append(h("p", { class: "empty" }, t("emptyLibrary")));
    else if (!visible.length) grid.append(h("p", { class: "empty" }, t("noResults")));
  };

  const addBooks = async () => {
    const selection = await open({
      multiple: true,
      filters: [{ name: t("ebookFiles"), extensions: formats.flatMap((f) => f.extensions) }],
    });
    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    if (!paths.length) return;

    const result = await api.addBooks(paths);
    const notes: string[] = [];
    if (result.duplicates.length) notes.push(t("duplicates", result.duplicates.length.toString()));
    if (result.unsupported.length) notes.push(t("unsupported", result.unsupported.join(", ")));
    status.textContent = notes.join(" · ");

    await refresh();
    for (const book of result.added) await enrichMetadata(book);
    await refresh();
  };

  const header = h(
    "header",
    { class: "toolbar" },
    h("h1", {}, t("appName")),
    h("input", {
      type: "search",
      class: "search",
      placeholder: t("searchLibrary"),
      "aria-label": t("searchLibrary"),
      oninput: (e: Event) => {
        query = (e.target as HTMLInputElement).value;
        draw();
      },
    }),
    h("button", { class: "primary", onclick: () => void addBooks() }, t("addBooks")),
  );

  root.replaceChildren(h("div", { class: "library" }, header, status, grid));
  draw();
}
