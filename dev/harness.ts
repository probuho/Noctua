// Dev-only: runs the real app UI in a plain browser with an in-memory fake of
// the Rust backend (Tauri's mockIPC), using the books in dev/fixtures.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Annotation, Book, Bookmark, Category, JournalEntry } from "../src/api";

// [fixture file, path shown in the library]
const FIXTURES: Array<[string, string]> = [
  ["sample.epub", "/books/sample.epub"],
  ["sample.pdf", "/books/sample.pdf"],
  ["sample.epub", "/books/novelas/otra-copia.epub"],
  // Password: noctua
  ["sample-protected.pdf", "/books/protegido.pdf"],
];

const now = () => Math.floor(Date.now() / 1000);
const files = new Map<number, ArrayBuffer>();
let books: Book[] = [];
let bookmarks: Bookmark[] = [];
let annotations: Annotation[] = [];
let journal: JournalEntry[] = [];
const settingsStore = new Map<string, string>();
/** Files "saved" through the export dialog, for automated checks. */
const exportsWritten: Record<string, string> = {};
const opened: string[] = [];
// Mirrored into the DOM so browser automation (isolated worlds) can read them.
const publish = () => {
  document.documentElement.dataset.harnessExports = JSON.stringify(exportsWritten);
  document.documentElement.dataset.harnessOpened = JSON.stringify(opened);
};
window.addEventListener("harness:open-url", (e) => {
  opened.push((e as CustomEvent<string>).detail);
  publish();
});
let categories: Category[] = [];
const originalCovers = new Map<number, string>();
let nextId = 1;
let fullscreen = false;

for (const [fixture, path] of FIXTURES) {
  const id = nextId++;
  files.set(id, await (await fetch(`./fixtures/${fixture}`)).arrayBuffer());
  books.push({
    id,
    path,
    format: fixture.split(".").pop()!,
    title: path.split("/").pop()!,
    author: null,
    description: null,
    cover: null,
    hasOriginalCover: false,
    size: files.get(id)!.byteLength,
    addedAt: now() - 100 + id,
    lastOpened: null,
    location: null,
    progress: 0,
    favorite: false,
    readAt: null,
    deletedAt: null,
    categoryIds: [],
    annotationCount: 0,
  });
}

type Args = Record<string, any>;
const byId = (id: number) => books.find((b) => b.id === id)!;
const each = (ids: number[], fn: (b: Book) => void) => ids.forEach((id) => fn(byId(id)));
const marksOf = (bookId: number) => bookmarks.filter((m) => m.bookId === bookId).sort((a, b) => a.progress - b.progress);
const notesOf = (bookId: number) =>
  annotations.filter((n) => n.bookId === bookId).sort((a, b) => a.progress - b.progress || a.id - b.id);
const journalOf = (bookId: number) =>
  journal.filter((j) => j.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt);
const withOriginal = (b: Book) => ({ ...b, hasOriginalCover: originalCovers.has(b.id), annotationCount: notesOf(b.id).length });

(window as any).__HARNESS__ = true;
mockWindows("main");
mockIPC((cmd, payload) => {
  const a = (payload ?? {}) as Args;
  switch (cmd) {
    case "supported_formats":
      return [
        { id: "epub", name: "EPUB", extensions: ["epub"] },
        { id: "pdf", name: "PDF", extensions: ["pdf"] },
      ];
    case "list_books":
      return books.map(withOriginal);
    case "add_books":
      return { added: [], duplicates: a.paths, unsupported: [] };
    case "open_book":
      byId(a.id).lastOpened = now();
      return files.get(a.id)!.slice(0);
    case "set_extracted_metadata": {
      const b = byId(a.id);
      if (a.title) b.title = a.title;
      if (a.author) b.author = a.author;
      if (a.cover) {
        b.cover = a.cover;
        originalCovers.set(b.id, a.cover);
      }
      return null;
    }
    case "update_book_properties": {
      const b = byId(a.id);
      b.title = a.title?.trim() || b.title;
      b.author = a.author;
      b.description = a.description;
      return withOriginal(b);
    }
    case "set_cover":
      byId(a.id).cover = a.cover;
      return withOriginal(byId(a.id));
    case "reset_cover":
      byId(a.id).cover = originalCovers.get(a.id) ?? null;
      return withOriginal(byId(a.id));
    case "save_progress":
      Object.assign(byId(a.id), { location: a.location, progress: a.progress });
      return null;
    case "set_favorite":
      return each(a.bookIds, (b) => (b.favorite = a.favorite)), null;
    case "set_read":
      return each(a.bookIds, (b) => (b.readAt = a.read ? now() : null)), null;
    case "trash_books":
      return each(a.bookIds, (b) => (b.deletedAt = now())), null;
    case "restore_books":
      return each(a.bookIds, (b) => (b.deletedAt = null)), null;
    case "delete_books":
      books = books.filter((b) => !a.bookIds.includes(b.id));
      return null;
    case "empty_trash":
      books = books.filter((b) => b.deletedAt === null);
      return null;
    case "list_categories":
      return [...categories].sort((x, y) => x.name.localeCompare(y.name));
    case "create_category": {
      if (categories.some((c) => c.name.toLowerCase() === a.name.trim().toLowerCase())) {
        throw new Error(`category "${a.name}" already exists`);
      }
      const category = { id: nextId++, name: a.name.trim() };
      categories.push(category);
      return category;
    }
    case "rename_category":
      categories.find((c) => c.id === a.id)!.name = a.name;
      return null;
    case "delete_category":
      categories = categories.filter((c) => c.id !== a.id);
      books.forEach((b) => (b.categoryIds = b.categoryIds.filter((id) => id !== a.id)));
      return null;
    case "add_to_category":
      return each(a.bookIds, (b) => !b.categoryIds.includes(a.categoryId) && b.categoryIds.push(a.categoryId)), null;
    case "remove_from_category":
      return each(a.bookIds, (b) => (b.categoryIds = b.categoryIds.filter((id) => id !== a.categoryId))), null;
    case "list_annotations":
      return notesOf(a.bookId);
    case "save_annotation": {
      const existing = annotations.find((n) => n.bookId === a.bookId && n.location === a.location);
      if (existing) Object.assign(existing, { color: a.color, note: a.note?.trim() || existing.note, updatedAt: now() });
      else
        annotations.push({
          id: nextId++,
          bookId: a.bookId,
          location: a.location,
          text: a.text,
          note: a.note?.trim() || null,
          color: a.color,
          progress: a.progress,
          createdAt: now(),
          updatedAt: now(),
        });
      return notesOf(a.bookId);
    }
    case "update_annotation":
      Object.assign(annotations.find((n) => n.id === a.id)!, { note: a.note?.trim() || null, color: a.color });
      return notesOf(a.bookId);
    case "delete_annotation":
      annotations = annotations.filter((n) => n.id !== a.id);
      return notesOf(a.bookId);
    case "clear_annotations":
      annotations = annotations.filter((n) => n.bookId !== a.bookId);
      return null;
    case "list_all_annotations": {
      const live = new Set(books.filter((b) => b.deletedAt === null).map((b) => b.id));
      return annotations.filter((n) => live.has(n.bookId)).sort((x, y) => y.createdAt - x.createdAt || y.id - x.id);
    }
    case "list_all_journal": {
      const live = new Set(books.filter((b) => b.deletedAt === null).map((b) => b.id));
      return journal.filter((j) => live.has(j.bookId)).sort((x, y) => y.createdAt - x.createdAt);
    }
    case "list_journal":
      return journalOf(a.bookId);
    case "add_journal_entry":
      if (!a.body?.trim()) throw new Error("journal entry is empty");
      journal.push({
        id: nextId++,
        bookId: a.bookId,
        body: a.body.trim(),
        location: a.location ?? null,
        progress: a.progress ?? null,
        createdAt: now() + nextId, // keeps a stable newest-first order
        updatedAt: now() + nextId,
      });
      return journalOf(a.bookId);
    case "update_journal_entry":
      Object.assign(journal.find((j) => j.id === a.id)!, { body: a.body.trim(), updatedAt: now() + 3600 });
      return journalOf(a.bookId);
    case "delete_journal_entry":
      journal = journal.filter((j) => j.id !== a.id);
      return journalOf(a.bookId);
    case "get_setting":
      return settingsStore.get(a.key) ?? null;
    case "set_setting":
      settingsStore.set(a.key, a.value);
      document.documentElement.dataset.harnessSettings = JSON.stringify(Object.fromEntries(settingsStore));
      return null;
    case "save_export":
      exportsWritten[a.path] = a.contents;
      publish();
      return null;
    case "plugin:dialog|save":
      return `/exports/${a.options?.defaultPath ?? "notes.html"}`;
    case "list_bookmarks":
      return marksOf(a.bookId);
    case "add_bookmark":
      bookmarks = bookmarks.filter((m) => !(m.bookId === a.bookId && m.location === a.location));
      bookmarks.push({ id: nextId++, bookId: a.bookId, location: a.location, label: a.label, progress: a.progress, createdAt: 0 });
      return marksOf(a.bookId);
    case "remove_bookmark":
      bookmarks = bookmarks.filter((m) => m.id !== a.id);
      return marksOf(a.bookId);
    case "clear_bookmarks":
      bookmarks = bookmarks.filter((m) => m.bookId !== a.bookId);
      return null;
    case "plugin:window|is_fullscreen":
      return fullscreen;
    case "plugin:window|set_fullscreen":
      fullscreen = Boolean(a.value);
      document.documentElement.dataset.fullscreen = String(fullscreen);
      return null;
    default:
      console.warn(`harness: unhandled command ${cmd}`, a);
      return null;
  }
});

// Fill in titles and covers the way the app does after adding books.
const { getFormat } = await import("../src/formats");
const { blobToThumbnail } = await import("../src/ui/dom");
for (const book of books) {
  // Protected books cannot be read without a password; keep the file name, like the app.
  const meta = await getFormat(book.format)
    .extractMetadata(new File([files.get(book.id)!], book.path))
    .catch(() => ({ title: undefined, author: undefined, cover: null }));
  Object.assign(book, { title: meta.title ?? book.title, author: meta.author ?? null });
  if (meta.cover) {
    book.cover = await blobToThumbnail(meta.cover);
    originalCovers.set(book.id, book.cover);
  }
}
books[2].title = "Otra copia del EPUB";
books[2].author = "Autora de prueba";

await import("../src/main");
