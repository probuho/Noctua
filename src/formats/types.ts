/**
 * Contract every format plugin implements. The backend only detects the
 * format (see `src-tauri/src/formats.rs`); parsing and rendering happen here.
 * A plugin's `id` must match the backend format id.
 */

export interface BookMetadata {
  title?: string;
  author?: string;
  cover?: Blob | null;
}

export interface TocItem {
  label: string;
  /** Opaque target understood by the plugin's `goTo`. */
  target: string;
  children?: TocItem[];
}

export interface ReadingPosition {
  /** Opaque, plugin-specific location (EPUB CFI, PDF page number, ...). */
  location: string;
  /** 0..1 */
  progress: number;
  /** Human-readable hint, e.g. the current chapter or "12 / 300". */
  label?: string;
  /** Current page and total, when the format has real pages. */
  page?: { current: number; total: number };
}

/** Text the reader selected inside the book. */
export interface TextSelection {
  /** Plugin-specific range (EPUB CFI range). */
  location: string;
  text: string;
  /** Approximate 0..1 position, used to keep notes in reading order. */
  progress: number;
  /** Where the selection is on screen (viewport coordinates). */
  rect: DOMRect;
}

export interface Highlight {
  location: string;
  /** Any CSS color. */
  color: string;
  /** Shows a marker so highlights with a note stand out. */
  note?: boolean;
}

export interface SearchResult {
  target: string;
  /** Section or page the match is in. */
  section: string;
  excerpt: { pre: string; match: string; post: string };
}

export type Theme = "light" | "sepia" | "dark" | "night-sepia";
export type FontFamily = "original" | "serif" | "sans" | "mono";
export type TextAlign = "original" | "left" | "justify";
/** Paginated with one or two pages, or one continuous scroll. */
export type PageLayout = "single" | "double" | "scroll";
export type PdfFit = "page" | "width";

export interface ReaderSettings {
  theme: Theme;
  /** Text size for reflowable books / zoom for fixed pages. 100 = original. */
  fontSize: number;
  fontFamily: FontFamily;
  lineHeight: number;
  textAlign: TextAlign;
  layout: PageLayout;
  pdfFit: PdfFit;
  /** 0 (off) .. 0.7: darkens the page without changing the theme. */
  dimming: number;
  /** Seconds between automatic page turns. */
  autoFlipSeconds: number;
}

/** What a format supports, so the UI only shows meaningful controls. */
export interface Capabilities {
  /** Fonts, spacing and alignment apply (false for fixed-page formats). */
  reflowable: boolean;
  /** Has real page numbers that "go to page" can target. */
  pages: boolean;
  /** Fit-to-width / fit-to-page apply. */
  fit: boolean;
  /** Text can be selected, highlighted and annotated. */
  annotations: boolean;
}

export interface ReaderSession {
  readonly capabilities: Capabilities;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<void>;
  /** 0..1 across the whole book. */
  goToFraction(fraction: number): Promise<void>;
  /** Returns to the position before the last jump (TOC, search, bookmark...). */
  back(): Promise<void>;
  canGoBack(): boolean;
  toc(): TocItem[];
  /** Streams matches; aborting the signal stops the search. */
  search(query: string, onResult: (result: SearchResult) => void, signal: AbortSignal): Promise<void>;
  clearSearch(): void;
  applySettings(settings: ReaderSettings): void;
  /** Fires with the new selection, or null when it is cleared. */
  onSelect(listener: (selection: TextSelection | null) => void): void;
  clearSelection(): void;
  /** Replaces every highlight shown in the book. */
  setHighlights(highlights: Highlight[]): void;
  /** Fires when the reader clicks an existing highlight. */
  onHighlightClick(listener: (location: string, rect: DOMRect) => void): void;
  /** Fires for links that leave the book; the plugin never opens them itself. */
  onExternalLink(listener: (url: string) => void): void;
  onRelocate(listener: (position: ReadingPosition) => void): void;
  destroy(): void;
}

/** Asks the reader for a password; `retry` is true after a wrong one. Null = cancelled. */
export type PasswordPrompt = (retry: boolean) => Promise<string | null>;

/** Thrown by `open` when the reader cancels the password prompt. */
export class PasswordCancelledError extends Error {
  constructor() {
    super("password cancelled");
    this.name = "PasswordCancelledError";
  }
}

export interface OpenOptions {
  location?: string | null;
  settings: ReaderSettings;
  /** Called for protected books. Without it, protected books fail to open. */
  requestPassword?: PasswordPrompt;
  /** Accessible names for controls the plugin draws (plugins stay i18n-free). */
  labels?: { page: (n: number) => string; web: (host: string) => string };
}

export interface FormatPlugin {
  id: string;
  name: string;
  extractMetadata(file: File): Promise<BookMetadata>;
  open(container: HTMLElement, file: File, options: OpenOptions): Promise<ReaderSession>;
}
