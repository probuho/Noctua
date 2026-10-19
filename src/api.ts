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
  updateProperties: (id: number, props: { title: string; author: string | null; description: string | null }) =>
    invoke<Book>("update_book_properties", { id, ...props }),
  setCover: (id: number, cover: string) => invoke<Book>("set_cover", { id, cover }),
  resetCover: (id: number) => invoke<Book>("reset_cover", { id }),
  saveProgress: (id: number, location: string, progress: number) =>
    invoke<void>("save_progress", { id, location, progress }),

  setFavorite: (bookIds: Ids, favorite: boolean) => invoke<void>("set_favorite", { bookIds, favorite }),
  setRead: (bookIds: Ids, read: boolean) => invoke<void>("set_read", { bookIds, read }),
  trashBooks: (bookIds: Ids) => invoke<void>("trash_books", { bookIds }),
  restoreBooks: (bookIds: Ids) => invoke<void>("restore_books", { bookIds }),
  deleteBooks: (bookIds: Ids) => invoke<void>("delete_books", { bookIds }),
  emptyTrash: () => invoke<void>("empty_trash"),

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
