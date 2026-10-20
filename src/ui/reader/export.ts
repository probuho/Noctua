import { save } from "@tauri-apps/plugin-dialog";
import { api, type Annotation, type Book, type JournalEntry } from "../../api";
import { t } from "../../i18n";
import { cssColor, type ColorName, type Labels } from "./annotations";

export type ExportFormat = "html" | "md";

/** Everything exported for one book. */
export interface ExportData {
  book: Book;
  notes: Annotation[];
  journal: JournalEntry[];
  labels: Labels;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dateLong = new Intl.DateTimeFormat(navigator.language, { dateStyle: "long" });
const dateTime = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" });
const today = () => dateLong.format(new Date());
const when = (seconds: number) => dateTime.format(new Date(seconds * 1000));
const percent = (p: number | null) => (p === null ? "" : `${Math.round(p * 100)}%`);
const labelOf = (labels: Labels, color: string) => labels[color as ColorName] ?? color;
const multiline = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");

// --- HTML ----------------------------------------------------------------------

/** Notes and journal of one book, with headings at `level`. */
function htmlBook({ notes, journal, labels }: ExportData, level: 2 | 3): string {
  const hn = `h${level}`;
  const noteItems = notes
    .map(
      (n) => `  <article>
    <p class="label"><span class="dot" style="background:${cssColor(n.color)}"></span>${escapeHtml(labelOf(labels, n.color))} · ${percent(n.progress)}</p>
    <blockquote style="border-color:${cssColor(n.color)}">${escapeHtml(n.text)}</blockquote>
    ${n.note ? `<p>${multiline(n.note)}</p>` : ""}
  </article>`,
    )
    .join("\n");
  const journalItems = journal
    .map(
      (j) => `  <article>
    <p class="label">${escapeHtml(when(j.createdAt))}${j.progress !== null ? ` · ${percent(j.progress)}` : ""}</p>
    <p>${multiline(j.body)}</p>
  </article>`,
    )
    .join("\n");
  return [
    notes.length ? `<${hn}>${escapeHtml(t("highlightsSection"))}</${hn}>\n${noteItems}` : "",
    journal.length ? `<${hn}>${escapeHtml(t("journalSection"))}</${hn}>\n${journalItems}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="${navigator.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1f1f1f; }
  header { margin-bottom: 2rem; }
  h1 { margin: 0; }
  h2 { margin-top: 2.5rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  h3 { margin-top: 1.75rem; }
  blockquote { margin: 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 4px solid; font-style: italic; }
  article { margin: 1.5rem 0; }
  article p { margin: 0.5rem 0 0; }
  .label, .meta { color: #595959; font-size: .9rem; margin: 0 0 .25rem; }
  .dot { display: inline-block; width: .7em; height: .7em; border-radius: 50%; margin-right: .4em; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const bookMeta = (book: Book) => escapeHtml(book.author ?? "");

export function notesToHtml(data: ExportData): string {
  const { book } = data;
  const meta = [bookMeta(book), escapeHtml(t("exportedOn", today()))].filter(Boolean).join(" · ");
  return htmlPage(
    t("notesOf", book.title),
    `<header>\n  <h1>${escapeHtml(book.title)}</h1>\n  <p class="meta">${meta}</p>\n</header>\n${htmlBook(data, 2)}`,
  );
}

/** Several books in one document, one section per book. */
export function notebookToHtml(groups: ExportData[]): string {
  const sections = groups
    .map((d) => `<h2>${escapeHtml(d.book.title)}</h2>\n${d.book.author ? `<p class="meta">${bookMeta(d.book)}</p>\n` : ""}${htmlBook(d, 3)}`)
    .join("\n");
  return htmlPage(
    t("notebook"),
    `<header>\n  <h1>${escapeHtml(t("notebook"))}</h1>\n  <p class="meta">${escapeHtml(t("exportedOn", today()))}</p>\n</header>\n${sections}`,
  );
}

// --- Markdown ------------------------------------------------------------------

function mdBook({ notes, journal, labels }: ExportData, level: 2 | 3): string {
  const hashes = "#".repeat(level);
  const quote = (s: string) => s.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  // Blank lines keep the note and the position outside the quote.
  const noteBlocks = notes.map((n) =>
    [`**${labelOf(labels, n.color)}** · ${percent(n.progress)}`, quote(n.text), n.note ?? ""].filter(Boolean).join("\n\n"),
  );
  const journalBlocks = journal.map((j) =>
    [`**${when(j.createdAt)}**${j.progress !== null ? ` · ${percent(j.progress)}` : ""}`, j.body].join("\n\n"),
  );
  return [
    notes.length ? `${hashes} ${t("highlightsSection")}\n\n${noteBlocks.join("\n\n---\n\n")}` : "",
    journal.length ? `${hashes} ${t("journalSection")}\n\n${journalBlocks.join("\n\n---\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function notesToMarkdown(data: ExportData): string {
  const meta = [data.book.author, t("exportedOn", today())].filter(Boolean).join(" · ");
  return `# ${data.book.title}\n\n_${meta}_\n\n${mdBook(data, 2)}\n`;
}

export function notebookToMarkdown(groups: ExportData[]): string {
  const sections = groups
    .map((d) => `## ${d.book.title}\n\n${d.book.author ? `_${d.book.author}_\n\n` : ""}${mdBook(d, 3)}`)
    .join("\n\n");
  return `# ${t("notebook")}\n\n_${t("exportedOn", today())}_\n\n${sections}\n`;
}

// --- Saving ----------------------------------------------------------------------

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "notes";

async function saveAs(baseName: string, format: ExportFormat, contents: string): Promise<string | null> {
  const path = await save({
    defaultPath: `${safeName(baseName)}.${format}`,
    filters: [{ name: format === "html" ? "HTML" : "Markdown", extensions: [format] }],
  });
  if (!path) return null;
  await api.saveExport(path, contents);
  return path;
}

/** Asks where to save and writes the file. Returns the path, or null if cancelled. */
export function exportNotes(data: ExportData, format: ExportFormat): Promise<string | null> {
  const contents = format === "html" ? notesToHtml(data) : notesToMarkdown(data);
  return saveAs(`${data.book.title} - ${t("notes")}`, format, contents);
}

export function exportNotebook(groups: ExportData[], format: ExportFormat): Promise<string | null> {
  const contents = format === "html" ? notebookToHtml(groups) : notebookToMarkdown(groups);
  return saveAs(`${t("appName")} - ${t("notebook")}`, format, contents);
}
