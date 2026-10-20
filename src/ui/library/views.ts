import type { Book } from "../../api";

/** What the library is showing; one entry per item in the sidebar. */
export type View =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "favorites" }
  | { kind: "read" }
  | { kind: "uncategorized" }
  | { kind: "trash" }
  /** Notes and journal of every book, instead of a grid of books. */
  | { kind: "notebook" }
  | { kind: "category"; id: number }
  | { kind: "format"; id: string };

export type SortKey = "recent" | "title" | "author" | "progress" | "added";

export const SORT_KEYS: SortKey[] = ["recent", "title", "author", "progress", "added"];

/** How many books "Recently read" keeps. */
export const RECENT_LIMIT = 20;

export const sameView = (a: View, b: View) => viewKey(a) === viewKey(b);

export function viewKey(view: View): string {
  return "id" in view ? `${view.kind}:${view.id}` : view.kind;
}

export function parseViewKey(key: string | null): View {
  const [kind, id] = (key ?? "all").split(":");
  if (kind === "category" && Number(id)) return { kind, id: Number(id) };
  if (kind === "format" && id) return { kind, id };
  if (["all", "recent", "favorites", "read", "uncategorized", "trash", "notebook"].includes(kind)) {
    return { kind } as View;
  }
  return { kind: "all" };
}

export function booksInView(books: Book[], view: View): Book[] {
  if (view.kind === "notebook") return [];
  if (view.kind === "trash") return books.filter((b) => b.deletedAt !== null);
  const live = books.filter((b) => b.deletedAt === null);
  switch (view.kind) {
    case "all":
      return live;
    case "recent":
      return live
        .filter((b) => b.lastOpened !== null)
        .sort((a, b) => b.lastOpened! - a.lastOpened!)
        .slice(0, RECENT_LIMIT);
    case "favorites":
      return live.filter((b) => b.favorite);
    case "read":
      return live.filter((b) => b.readAt !== null);
    case "uncategorized":
      return live.filter((b) => b.categoryIds.length === 0);
    case "category":
      return live.filter((b) => b.categoryIds.includes(view.id));
    case "format":
      return live.filter((b) => b.format === view.id);
  }
}

export function matchesQuery(book: Book, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || `${book.title} ${book.author ?? ""}`.toLocaleLowerCase().includes(q);
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortBooks(books: Book[], key: SortKey): Book[] {
  const sorted = [...books];
  switch (key) {
    case "recent":
      return sorted.sort((a, b) => (b.lastOpened ?? b.addedAt) - (a.lastOpened ?? a.addedAt));
    case "title":
      return sorted.sort((a, b) => collator.compare(a.title, b.title));
    case "author":
      // Books without an author go last.
      return sorted.sort(
        (a, b) =>
          Number(!a.author) - Number(!b.author) ||
          collator.compare(a.author ?? "", b.author ?? "") ||
          collator.compare(a.title, b.title),
      );
    case "progress":
      return sorted.sort((a, b) => b.progress - a.progress);
    case "added":
      return sorted.sort((a, b) => b.addedAt - a.addedAt);
  }
}

/** The book to offer in "Continue reading": last opened and not finished. */
export function continueCandidate(books: Book[]): Book | null {
  const recent = booksInView(books, { kind: "recent" });
  return recent.find((b) => b.progress < 0.99 && b.readAt === null) ?? null;
}
