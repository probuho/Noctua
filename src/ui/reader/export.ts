import { save } from "@tauri-apps/plugin-dialog";
import { api, type Annotation, type Book } from "../../api";
import { t } from "../../i18n";
import { cssColor } from "./annotations";

export type ExportFormat = "html" | "md";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const today = () => new Intl.DateTimeFormat(navigator.language, { dateStyle: "long" }).format(new Date());

export function notesToHtml(book: Book, notes: Annotation[]): string {
  const items = notes
    .map(
      (n) => `  <article>
    <blockquote style="border-color:${cssColor(n.color)}">${escapeHtml(n.text)}</blockquote>
    ${n.note ? `<p>${escapeHtml(n.note).replace(/\n/g, "<br>")}</p>` : ""}
    <small>${Math.round(n.progress * 100)}%</small>
  </article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${navigator.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t("notesOf", book.title))}</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1f1f1f; }
  header { margin-bottom: 2rem; }
  h1 { margin: 0; }
  blockquote { margin: 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 4px solid; font-style: italic; }
  article { margin: 1.5rem 0; }
  article p { margin: 0.5rem 0 0; }
  small, .meta { color: #6b6b6b; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(book.title)}</h1>
  <p class="meta">${escapeHtml(book.author ?? "")}${book.author ? " · " : ""}${escapeHtml(t("exportedOn", today()))}</p>
</header>
${items}
</body>
</html>
`;
}

export function notesToMarkdown(book: Book, notes: Annotation[]): string {
  const quote = (s: string) => s.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  const body = notes
    // Blank lines keep the note and the position outside the quote.
    .map((n) => [quote(n.text), n.note ? `\n\n${n.note}` : "", `\n\n*${Math.round(n.progress * 100)}%*`].join(""))
    .join("\n\n---\n\n");
  const meta = [book.author, t("exportedOn", today())].filter(Boolean).join(" · ");
  return `# ${book.title}\n\n_${meta}_\n\n${body}\n`;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "notes";

/** Asks where to save and writes the file. Returns the path, or null if cancelled. */
export async function exportNotes(book: Book, notes: Annotation[], format: ExportFormat): Promise<string | null> {
  const contents = format === "html" ? notesToHtml(book, notes) : notesToMarkdown(book, notes);
  const path = await save({
    defaultPath: `${safeName(book.title)} - ${t("notes")}.${format}`,
    filters: [{ name: format === "html" ? "HTML" : "Markdown", extensions: [format] }],
  });
  if (!path) return null;
  await api.saveExport(path, contents);
  return path;
}
