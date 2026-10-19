import { invoke } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  path: string;
  format: string;
  title: string;
  author: string | null;
  cover: string | null;
  size: number;
  addedAt: number;
  lastOpened: number | null;
  location: string | null;
  progress: number;
}

export interface Bookmark {
  id: number;
  bookId: number;
  location: string;
  label: string;
  progress: number;
  createdAt: number;
}

export interface FormatInfo {
  id: string;
  name: string;
  extensions: string[];
}

export interface AddResult {
  added: Book[];
  duplicates: string[];
  unsupported: string[];
}

export const api = {
  supportedFormats: () => invoke<FormatInfo[]>("supported_formats"),
  listBooks: () => invoke<Book[]>("list_books"),
  addBooks: (paths: string[]) => invoke<AddResult>("add_books", { paths }),
  removeBook: (id: number) => invoke<void>("remove_book", { id }),
  openBook: (id: number) => invoke<ArrayBuffer>("open_book", { id }),
  updateMetadata: (id: number, meta: { title?: string; author?: string; cover?: string }) =>
    invoke<void>("update_book_metadata", { id, ...meta }),
  saveProgress: (id: number, location: string, progress: number) =>
    invoke<void>("save_progress", { id, location, progress }),
  listBookmarks: (bookId: number) => invoke<Bookmark[]>("list_bookmarks", { bookId }),
  addBookmark: (bookId: number, location: string, label: string, progress: number) =>
    invoke<Bookmark[]>("add_bookmark", { bookId, location, label, progress }),
  removeBookmark: (id: number, bookId: number) => invoke<Bookmark[]>("remove_bookmark", { id, bookId }),
  clearBookmarks: (bookId: number) => invoke<void>("clear_bookmarks", { bookId }),
};

/** Wraps the raw bytes returned by `open_book` in a File plugins can consume. */
export async function loadBookFile(book: Book): Promise<File> {
  const bytes = await api.openBook(book.id);
  const name = book.path.split(/[\\/]/).pop() ?? `book.${book.format}`;
  return new File([bytes], name);
}
