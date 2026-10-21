import "./styles.css";
import "./formats";
import { api, type Book } from "./api";
import { renderLibrary } from "./ui/library/index";
import { renderReader } from "./ui/reader";
import { applyAppTheme, loadSettings } from "./ui/theme";

// Browsers report this when a resize triggers another layout in the same
// frame (foliate's paginator does it on purpose). It is harmless, but the dev
// error overlay would treat it as a crash.
window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver loop")) e.stopImmediatePropagation();
});

const root = document.getElementById("app")!;

// The open book survives a reload (F5 / Ctrl+R): the webview reloads the page,
// so remember it for this window session and reopen it where it was.
const OPEN_BOOK_KEY = "noctua-open-book";
const session = {
  get: () => {
    try {
      return Number(sessionStorage.getItem(OPEN_BOOK_KEY)) || null;
    } catch {
      return null;
    }
  },
  set: (id: number | null) => {
    try {
      if (id === null) sessionStorage.removeItem(OPEN_BOOK_KEY);
      else sessionStorage.setItem(OPEN_BOOK_KEY, String(id));
    } catch {
      /* storage unavailable: a reload just shows the library */
    }
  },
};

function showLibrary(): void {
  session.set(null);
  void renderLibrary(root, showReader);
}

function showReader(book: Book, jumpTo?: string): void {
  session.set(book.id);
  void renderReader(root, book, showLibrary, jumpTo);
}

async function start(): Promise<void> {
  applyAppTheme(loadSettings().theme);
  const openId = session.get();
  if (openId !== null) {
    const book = (await api.listBooks().catch(() => [])).find((b) => b.id === openId && b.deletedAt === null);
    if (book) return showReader(book);
  }
  showLibrary();
}

void start();
