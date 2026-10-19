// Minimal typings for the parts of foliate-js (MIT, vendored as a git
// submodule in src/vendor/foliate-js) that this app uses.

declare module "foliate-js/view.js" {
  type LangMap = string | Record<string, string>;
  type Contributor = LangMap | { name: LangMap } | Array<LangMap | { name: LangMap }>;

  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[] | null;
  }

  export interface FoliateBook {
    metadata?: { title?: LangMap; author?: Contributor; language?: string | string[] };
    toc?: FoliateTocItem[] | null;
    getCover?(): Promise<Blob | null>;
    destroy?(): void;
  }

  export interface RelocateDetail {
    fraction?: number;
    cfi?: string;
    tocItem?: { label?: string } | null;
  }

  export interface SearchExcerpt {
    pre: string;
    match: string;
    post: string;
  }

  export type SearchEvent =
    | "done"
    | { progress: number }
    | { label: string; subitems: Array<{ cfi: string; excerpt: SearchExcerpt }> };

  export interface FoliateHistory extends EventTarget {
    back(): void;
    forward(): void;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles?(css: string): void;
  }

  export interface FoliateAnnotation {
    value: string;
    color?: string;
  }

  /** Detail of "draw-annotation": call draw(Overlayer.highlight, { color }). */
  export interface DrawAnnotationDetail {
    draw(fn: unknown, options?: Record<string, unknown>): void;
    annotation: FoliateAnnotation;
  }

  export interface FoliateView extends HTMLElement {
    book: FoliateBook;
    lastLocation?: RelocateDetail | null;
    renderer: FoliateRenderer;
    open(file: File | Blob | string): Promise<void>;
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    history: FoliateHistory;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    search(opts: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean }): AsyncGenerator<SearchEvent>;
    clearSearch(): void;
    getCFI(index: number, range: Range): string;
    addAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
    deleteAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
    deselect(): void;
    prev(): Promise<void>;
    next(): Promise<void>;
    close(): void;
  }

  export function makeBook(file: File | Blob | string): Promise<FoliateBook>;
}

declare module "foliate-js/overlayer.js" {
  export class Overlayer {
    static highlight: unknown;
    static underline: unknown;
    static outline: unknown;
  }
}
