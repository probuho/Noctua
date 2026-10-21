import "@fontsource-variable/inter";
import "@fontsource-variable/lexend";
import "@fontsource-variable/literata";
import "./styles.css";
import "./design.css";
import "./formats";
import { api, type Book } from "./api";
import { renderCollections } from "./ui/collections";
import { renderHome } from "./ui/home";
import { renderLibrary } from "./ui/library/index";
import { applyMode } from "./ui/mode";
import { renderNotesPage } from "./ui/notes-page";
import { renderReader } from "./ui/reader";
import { renderShell, type Route } from "./ui/shell";
import { renderStats } from "./ui/stats-page";
import { applyAppTheme, loadSettings } from "./ui/theme";
import { toggleFullscreen } from "./ui/fullscreen";

// Browsers report this when a resize triggers another layout in the same
// frame (foliate's paginator does it on purpose). It is harmless, but the dev
// error overlay would treat it as a crash.
window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver loop")) e.stopImmediatePropagation();
});

const root = document.getElementById("app")!;

// Where the user is survives a reload (F5 / Ctrl+R) of the window.
const STATE_KEY = "noctua-location";
type Place = { route: Route; view?: string } | { book: number; back: Route };
const place = {
  get(): Place | null {
    try {
      return JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(value: Place) {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(value));
    } catch {
      /* a reload then starts at Inicio */
    }
  },
};

let lastRoute: Route = "home";

function go(route: Route, libraryView?: string): void {
  lastRoute = route;
  place.set({ route, view: libraryView });
  const content = renderShell(root, route, go);
  const openBook = (book: Book, opts?: { panel?: "bookmarks" }) => showReader(book, undefined, opts?.panel);
  switch (route) {
    case "home":
      void renderHome(content, { go, openBook });
      break;
    case "library":
      void renderLibrary(content, (book, jumpTo) => showReader(book, jumpTo), libraryView);
      break;
    case "collections":
      void renderCollections(content, go);
      break;
    case "notes":
      void renderNotesPage(content, (book, jumpTo) => showReader(book, jumpTo));
      break;
    case "stats":
      void renderStats(content);
      break;
  }
}

function showReader(book: Book, jumpTo?: string, panel?: "bookmarks"): void {
  const back = lastRoute;
  place.set({ book: book.id, back });
  void renderReader(root, book, () => go(back), jumpTo, panel);
}

// F11 toggles full screen everywhere (the reader also has its own button).
window.addEventListener("keydown", (e) => {
  if (e.key === "F11") {
    e.preventDefault();
    void toggleFullscreen();
  }
});

async function start(): Promise<void> {
  applyMode();
  applyAppTheme(loadSettings().theme);
  const saved = place.get();
  if (saved && "book" in saved) {
    lastRoute = saved.back;
    const book = (await api.listBooks().catch(() => [])).find((b) => b.id === saved.book && b.deletedAt === null);
    if (book) return showReader(book);
    return go(saved.back);
  }
  go(saved?.route ?? "home", saved?.view);
}

void start();
