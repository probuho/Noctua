import "./styles.css";
import "./formats";
import type { Book } from "./api";
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

function showLibrary(): void {
  void renderLibrary(root, showReader);
}

function showReader(book: Book): void {
  void renderReader(root, book, showLibrary);
}

applyAppTheme(loadSettings().theme);
showLibrary();
