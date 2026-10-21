import { invoke } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  path: string;
  format: string;
  title: string;
  author: string | null;
  description: string | null;
  cover: string | null;
  hasOriginalCover: boolean;
  size: number;
  addedAt: number;
  lastOpened: number | null;
  location: string | null;
  progress: number;
  favorite: boolean;
  readAt: number | null;
  deletedAt: number | null;
  categoryIds: number[];
  annotationCount: number;
}

export interface Annotation {
  id: number;
  bookId: number;
  location: string;
  text: string;
  note: string | null;
  color: string;
  progress: number;
  createdAt: number;
  updatedAt: number;
}

export interface MetadataCandidate {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  coverId: number | null;
  publisher: string | null;
  languages: string[];
}

export interface JournalFile {
  folder: string | null;
  file: string;
  contents: string;
}

export interface JournalEntry {
  id: number;
  bookId: number;
  body: string;
  location: string | null;
  progress: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: number;
  name: string;
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

type Ids = number[];

export const api = {
  supportedFormats: () => invoke<FormatInfo[]>("supported_formats"),

  listBooks: () => invoke<Book[]>("list_books"),
  /** Files and folders; folders are scanned recursively. */
  addBooks: (paths: string[]) => invoke<AddResult>("add_books", { paths }),
  openBook: (id: number) => invoke<ArrayBuffer>("open_book", { id }),
  setExtractedMetadata: (id: number, meta: { title?: string; author?: string; cover?: string }) =>
    invoke<void>("set_extracted_metadata", { id, ...meta }),
  /** Saves the details; optionally renames the file and writes them inside it (EPUB). */
  updateProperties: (
    id: number,
    props: { title: string; author: string | null; description: string | null; renameFile: boolean; writeToFile: boolean },
  ) => invoke<{ book: Book; warnings: string[] }>("update_book_properties", { id, ...props }),
  setCover: (id: number, cover: string) => invoke<Book>("set_cover", { id, cover }),
  resetCover: (id: number) => invoke<Book>("reset_cover", { id }),
  saveProgress: (id: number, location: string, progress: number) =>
    invoke<void>("save_progress", { id, location, progress }),

  setFavorite: (bookIds: Ids, favorite: boolean) => invoke<void>("set_favorite", { bookIds, favorite }),
  setRead: (bookIds: Ids, read: boolean) => invoke<void>("set_read", { bookIds, read }),
  trashBooks: (bookIds: Ids) => invoke<void>("trash_books", { bookIds }),
  restoreBooks: (bookIds: Ids) => invoke<void>("restore_books", { bookIds }),
  /** With `deleteFiles`, files go to the system trash. Returns files that could not be moved. */
  deleteBooks: (bookIds: Ids, deleteFiles: boolean) => invoke<string[]>("delete_books", { bookIds, deleteFiles }),
  emptyTrash: (deleteFiles: boolean) => invoke<string[]>("empty_trash", { deleteFiles }),

  listCategories: () => invoke<Category[]>("list_categories"),
  createCategory: (name: string) => invoke<Category>("create_category", { name }),
  renameCategory: (id: number, name: string) => invoke<void>("rename_category", { id, name }),
  deleteCategory: (id: number) => invoke<void>("delete_category", { id }),
  addToCategory: (bookIds: Ids, categoryId: number) => invoke<void>("add_to_category", { bookIds, categoryId }),
  removeFromCategory: (bookIds: Ids, categoryId: number) =>
    invoke<void>("remove_from_category", { bookIds, categoryId }),

  listAnnotations: (bookId: number) => invoke<Annotation[]>("list_annotations", { bookId }),
  saveAnnotation: (a: { bookId: number; location: string; text: string; note?: string | null; color: string; progress: number }) =>
    invoke<Annotation[]>("save_annotation", a),
  updateAnnotation: (id: number, bookId: number, note: string | null, color: string) =>
    invoke<Annotation[]>("update_annotation", { id, bookId, note, color }),
  deleteAnnotation: (id: number, bookId: number) => invoke<Annotation[]>("delete_annotation", { id, bookId }),
  clearAnnotations: (bookId: number) => invoke<void>("clear_annotations", { bookId }),
  /** Only .html, .md and .txt paths are accepted. */
  saveExport: (path: string, contents: string) => invoke<void>("save_export", { path, contents }),

  listJournal: (bookId: number) => invoke<JournalEntry[]>("list_journal", { bookId }),
  addJournalEntry: (bookId: number, body: string, location: string | null, progress: number | null) =>
    invoke<JournalEntry[]>("add_journal_entry", { bookId, body, location, progress }),
  updateJournalEntry: (id: number, bookId: number, body: string) =>
    invoke<JournalEntry[]>("update_journal_entry", { id, bookId, body }),
  deleteJournalEntry: (id: number, bookId: number) => invoke<JournalEntry[]>("delete_journal_entry", { id, bookId }),

  /** Open Library: sends only the title and author typed by the user. */
  metadataSearch: (title: string, author: string | null) => invoke<MetadataCandidate[]>("metadata_search", { title, author }),
  metadataDescription: (key: string) => invoke<string | null>("metadata_description", { key }),
  metadataCover: (coverId: number, size: "S" | "M" | "L") => invoke<ArrayBuffer>("metadata_cover", { coverId, size }),

  /** Reading journal: one Markdown file per book in a folder the user picks. */
  journalFolder: () => invoke<string | null>("journal_folder"),
  setJournalFolder: (path: string) => invoke<void>("set_journal_folder", { path }),
  journalRead: (bookId: number) => invoke<JournalFile>("journal_read", { bookId }),
  /** Returns the whole file after appending. */
  journalAppend: (bookId: number, section: string) => invoke<string>("journal_append", { bookId, section }),
  journalWrite: (bookId: number, contents: string) => invoke<void>("journal_write", { bookId, contents }),
  /** `data` is base64; returns the path relative to the folder ("attachments/…"). */
  journalSaveImage: (data: string, extension: string) => invoke<string>("journal_save_image", { data, extension }),
  journalImage: (path: string) => invoke<ArrayBuffer>("journal_image", { path }),

  /** Library-wide notebook (books in the trash are left out). */
  listAllAnnotations: () => invoke<Annotation[]>("list_all_annotations"),
  listAllJournal: () => invoke<JournalEntry[]>("list_all_journal"),

  /** App-wide settings stored in the library database (JSON values). */
  getSetting: async <T>(key: string): Promise<T | null> => {
    const raw = await invoke<string | null>("get_setting", { key });
    return raw === null ? null : (JSON.parse(raw) as T);
  },
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value: JSON.stringify(value) }),

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
