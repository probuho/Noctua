// Dev-only: runs the real app UI in a plain browser with an in-memory fake of
// the Rust backend (Tauri's mockIPC), using the books in dev/fixtures.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Book, Bookmark } from "../src/api";

const FIXTURES = ["sample.epub", "sample.pdf"];

const files = new Map<number, ArrayBuffer>();
const books: Book[] = [];
let bookmarks: Bookmark[] = [];
let nextId = 1;
let fullscreen = false;

for (const name of FIXTURES) {
  const id = nextId++;
  files.set(id, await (await fetch(`./fixtures/${name}`)).arrayBuffer());
  books.push({
    id,
    path: `/fixtures/${name}`,
    format: name.split(".").pop()!,
    title: name,
    author: null,
    cover: null,
    size: files.get(id)!.byteLength,
    addedAt: id,
    lastOpened: null,
    location: null,
    progress: 0,
  });
}

type Args = Record<string, any>;
const byId = (id: number) => books.find((b) => b.id === id)!;
const marksOf = (bookId: number) => bookmarks.filter((m) => m.bookId === bookId).sort((a, b) => a.progress - b.progress);

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
      return books;
    case "open_book":
      return files.get(a.id)!.slice(0);
    case "update_book_metadata":
      Object.assign(byId(a.id), Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== "id" && v != null)));
      return null;
    case "save_progress":
      Object.assign(byId(a.id), { location: a.location, progress: a.progress });
      return null;
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
for (const book of books) {
  const meta = await getFormat(book.format).extractMetadata(new File([files.get(book.id)!], book.path));
  Object.assign(book, { title: meta.title ?? book.title, author: meta.author ?? null });
}

await import("../src/main");
