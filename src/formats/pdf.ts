import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { decodeLocation, encodeLocation, pageOfTarget, rectsInPage, textRanges, type PdfRect } from "./pdf-geometry";
import type { FormatPlugin, Highlight, ReadingPosition, TextSelection, TocItem } from "./types";

/** One rendered page. */
interface PageView {
  n: number;
  el: HTMLElement;
  /** Highlights and search matches, painted under the text layer. */
  marks: HTMLElement;
  textDiv: HTMLElement;
  scale: number;
  task: RenderTask;
  textLayer: pdfjs.TextLayer;
  textReady: boolean;
}

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Keep the loading task: in PDF.js 6 it is what owns the worker and gets destroyed. */
async function loadPdf(file: File): Promise<{ pdf: PDFDocumentProxy; task: PDFDocumentLoadingTask }> {
  // Copied to public/pdfjs by scripts/copy-pdfjs-assets.mjs. Without them,
  // scanned pages (JPEG 2000 / JBIG2), CJK text and non-embedded fonts break.
  const assets = `${import.meta.env.BASE_URL}pdfjs/`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: `${assets}wasm/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    iccUrl: `${assets}iccs/`,
  });
  return { pdf: await task.promise, task };
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

async function resolveOutline(pdf: PDFDocumentProxy, nodes: OutlineNode[] | null): Promise<TocItem[]> {
  const items: TocItem[] = [];
  for (const node of nodes ?? []) {
    let page: number | null = null;
    try {
      const dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
      const ref = dest?.[0];
      if (ref && typeof ref === "object") page = (await pdf.getPageIndex(ref)) + 1;
      else if (typeof ref === "number") page = ref + 1;
    } catch {
      // Broken outline entries are common; skip them.
    }
    const children = await resolveOutline(pdf, node.items);
    if (page !== null || children.length) {
      items.push({ label: node.title || "—", target: String(page ?? 1), children: children.length ? children : undefined });
    }
  }
  return items;
}

async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | null> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 400 / base.height });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

export const pdfPlugin: FormatPlugin = {
  id: "pdf",
  name: "PDF",

  async extractMetadata(file) {
    const { pdf, task } = await loadPdf(file);
    try {
      const { info } = (await pdf.getMetadata()) as { info: { Title?: string; Author?: string } };
      return {
        title: info?.Title?.trim() || undefined,
        author: info?.Author?.trim() || undefined,
        cover: await renderCover(pdf),
      };
    } finally {
      await task.destroy();
    }
  },

  async open(container, file, { location, settings }) {
    const { pdf, task: loading } = await loadPdf(file);
    const toc = await resolveOutline(pdf, await pdf.getOutline());
    const total = pdf.numPages;
    // Continuous mode lays out every page with this size until it is rendered.
    const firstBase = (await pdf.getPage(1)).getViewport({ scale: 1 });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-view";
    const spread = document.createElement("div");
    wrapper.append(spread);
    container.append(wrapper);

    const listeners: Array<(p: ReadingPosition) => void> = [];
    const selectListeners: Array<(s: TextSelection | null) => void> = [];
    const highlightListeners: Array<(location: string, rect: DOMRect) => void> = [];
    const history: number[] = [];
    const pageText = new Map<number, string>();
    /** Pages currently rendered, by page number. */
    const views = new Map<number, PageView>();
    let current = clampPage(Number(location) || 1);
    let opts = { ...settings };
    let generation = 0;
    let observer: IntersectionObserver | null = null;
    /** location -> highlight shown in the book. */
    let highlights = new Map<string, Highlight>();
    let searchQuery: string | null = null;

    function clampPage(n: number): number {
      return Math.min(Math.max(Math.round(n), 1), total);
    }

    const isScroll = () => opts.layout === "scroll";
    const pagesShown = () => (opts.layout === "double" && current < total ? 2 : 1);

    // --- Painting highlights and search matches --------------------------------

    const mark = (layer: HTMLElement, r: PdfRect, scale: number, className: string) => {
      const el = document.createElement("div");
      el.className = className;
      Object.assign(el.style, {
        left: `${r.x * scale}px`,
        top: `${r.y * scale}px`,
        width: `${r.w * scale}px`,
        height: `${r.h * scale}px`,
      });
      layer.append(el);
      return el;
    };

    const paintHighlights = (view: PageView) => {
      view.marks.querySelectorAll(".pdf-highlight, .note-marker").forEach((el) => el.remove());
      for (const [value, h] of highlights) {
        const decoded = decodeLocation(value);
        if (decoded?.page !== view.n) continue;
        for (const r of decoded.rects) {
          const el = mark(view.marks, r, view.scale, "pdf-highlight");
          el.style.background = h.color;
          el.dataset.location = value;
        }
        // Highlights with a note get a visible marker at their end.
        const last = decoded.rects[decoded.rects.length - 1];
        if (h.note && last) {
          const marker = mark(view.marks, { x: last.x + last.w, y: last.y, w: 0, h: 0 }, view.scale, "note-marker");
          marker.style.setProperty("--marker-color", h.color);
        }
      }
    };

    const paintSearch = (view: PageView) => {
      view.marks.querySelectorAll(".pdf-search").forEach((el) => el.remove());
      if (!searchQuery || !view.textReady) return;
      for (const range of textRanges(view.textDiv, searchQuery)) {
        for (const r of rectsInPage(range, view.el, view.scale)) mark(view.marks, r, view.scale, "pdf-search");
      }
    };

    // --- Rendering -----------------------------------------------------------------

    const scaleFor = (bases: Array<{ width: number; height: number }>) => {
      const width = isScroll() ? bases[0].width : bases.reduce((sum, b) => sum + b.width, 0);
      const height = Math.max(...bases.map((b) => b.height));
      const byWidth = wrapper.clientWidth / width;
      const fit = opts.pdfFit === "width" ? byWidth : Math.min(byWidth, wrapper.clientHeight / height);
      // Leave a small margin so the page never triggers scrollbars at 100%.
      return 0.96 * fit * (opts.fontSize / 100);
    };

    /** Draws one page (canvas, marks, selectable text) into `el`. */
    const fillPage = (el: HTMLElement, page: PDFPageProxy, n: number, scale: number): PageView => {
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      // The text layer sizes its glyphs from this variable.
      el.style.setProperty("--total-scale-factor", String(scale));

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const marks = document.createElement("div");
      marks.className = "pdf-marks";
      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      el.replaceChildren(canvas, marks, textDiv);

      const task = page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      task.promise.catch((err) => {
        if ((err as Error)?.name !== "RenderingCancelledException") console.error(err);
      });
      // Selectable text goes on top of the canvas; scanned pages simply have none.
      const textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      const view: PageView = { n, el, marks, textDiv, scale, task, textLayer, textReady: false };
      textLayer.render().then(
        () => {
          view.textReady = true;
          paintSearch(view);
        },
        () => {},
      );
      paintHighlights(view);
      return view;
    };

    const dropView = (view: PageView) => {
      view.task.cancel();
      view.textLayer.cancel();
      view.el.replaceChildren();
    };

    const clearViews = () => {
      views.forEach(dropView);
      views.clear();
      observer?.disconnect();
      observer = null;
    };

    const emitPosition = () => {
      const last = isScroll() ? current : current + pagesShown() - 1;
      const position: ReadingPosition = {
        location: String(current),
        progress: last / total,
        label: last !== current ? `${current}–${last} / ${total}` : `${current} / ${total}`,
        page: { current, total },
      };
      listeners.forEach((l) => l(position));
    };

    const pageEl = (n: number) => spread.children[n - 1] as HTMLElement | undefined;

    const scrollToPage = (n: number) => {
      const el = pageEl(n);
      if (el) wrapper.scrollTop = el.offsetTop - 8;
    };

    const renderPaged = async (gen: number) => {
      const numbers = pagesShown() === 2 ? [current, current + 1] : [current];
      const pages = await Promise.all(numbers.map((n) => pdf.getPage(n)));
      if (gen !== generation) return;
      const scale = scaleFor(pages.map((p) => p.getViewport({ scale: 1 })));
      const els = numbers.map(() => Object.assign(document.createElement("div"), { className: "pdf-page" }));
      spread.replaceChildren(...els);
      numbers.forEach((n, i) => views.set(n, fillPage(els[i], pages[i], n, scale)));
      wrapper.scrollTop = 0;
      emitPosition();
    };

    /** All pages stacked; only the ones near the viewport are rendered. */
    const renderScroll = (gen: number) => {
      const scale = scaleFor([firstBase]);
      const els = Array.from({ length: total }, (_, i) => {
        const el = document.createElement("div");
        el.className = "pdf-page";
        el.dataset.page = String(i + 1);
        el.style.width = `${Math.floor(firstBase.width * scale)}px`;
        el.style.height = `${Math.floor(firstBase.height * scale)}px`;
        return el;
      });
      spread.replaceChildren(...els);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const n = Number(el.dataset.page);
            if (entry.isIntersecting && !views.has(n)) {
              void pdf.getPage(n).then((page) => {
                if (gen === generation && !views.has(n)) views.set(n, fillPage(el, page, n, scale));
              });
            } else if (!entry.isIntersecting && views.has(n)) {
              // Free far-away pages so long documents stay light.
              dropView(views.get(n)!);
              views.delete(n);
            }
          }
        },
        { root: wrapper, rootMargin: "150% 0px" },
      );
      els.forEach((el) => observer!.observe(el));
      scrollToPage(current);
      emitPosition();
    };

    const render = async () => {
      const gen = ++generation;
      clearViews();
      wrapper.dataset.theme = opts.theme;
      wrapper.dataset.fit = opts.pdfFit;
      wrapper.dataset.layout = opts.layout;
      spread.className = isScroll() ? "pdf-column" : "pdf-spread";
      if (isScroll()) renderScroll(gen);
      else await renderPaged(gen);
    };

    // In continuous mode the page at the top third of the view is "current".
    let scrollFrame = 0;
    wrapper.addEventListener("scroll", () => {
      if (!isScroll()) return;
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const probe = wrapper.scrollTop + wrapper.clientHeight / 3;
        let n = 1;
        for (const el of spread.children as HTMLCollectionOf<HTMLElement>) {
          if (el.offsetTop > probe) break;
          n = Number(el.dataset.page);
        }
        if (n !== current) {
          current = n;
          emitPosition();
        }
      });
    });

    const show = async (n: number, { jump }: { jump: boolean }) => {
      const next = clampPage(n);
      if (next === current) return;
      if (jump) history.push(current);
      current = next;
      if (isScroll()) {
        scrollToPage(current);
        emitPosition();
      } else {
        await render();
      }
    };

    const textOf = async (n: number): Promise<string> => {
      let text = pageText.get(n);
      if (text === undefined) {
        const content = await (await pdf.getPage(n)).getTextContent();
        text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ");
        pageText.set(n, text);
      }
      return text;
    };

    // --- Selection and clicks on highlights ------------------------------------
    wrapper.addEventListener("pointerup", (e) => {
      const selection = document.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!selection || selection.isCollapsed || !text) {
        selectListeners.forEach((l) => l(null));
        // A plain click on a highlight opens it.
        const hit = [...wrapper.querySelectorAll<HTMLElement>(".pdf-highlight")].find((el) => {
          const r = el.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (hit) highlightListeners.forEach((l) => l(hit.dataset.location!, hit.getBoundingClientRect()));
        return;
      }
      const range = selection.getRangeAt(0);
      const view = [...views.values()].find((v) => v.el.contains(range.startContainer));
      if (!view) return;
      const rects = rectsInPage(range, view.el, view.scale);
      if (!rects.length) return;
      selectListeners.forEach((l) =>
        l({ location: encodeLocation(view.n, rects), text, progress: view.n / total, rect: range.getBoundingClientRect() }),
      );
    });

    // Re-render only when the available area really changes, outside the
    // observer callback, to avoid "ResizeObserver loop" errors.
    let lastSize = "";
    let frame = 0;
    const resize = new ResizeObserver(() => {
      const size = `${wrapper.clientWidth}x${wrapper.clientHeight}`;
      if (size === lastSize) return;
      lastSize = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void render());
    });
    resize.observe(wrapper);

    return {
      capabilities: { reflowable: false, pages: true, fit: true, annotations: true },
      next: async () => {
        if (isScroll()) wrapper.scrollBy({ top: wrapper.clientHeight * 0.9 });
        else await show(current + pagesShown(), { jump: false });
      },
      prev: async () => {
        if (isScroll()) wrapper.scrollBy({ top: -wrapper.clientHeight * 0.9 });
        else await show(current - (opts.layout === "double" ? 2 : 1), { jump: false });
      },
      goTo: (target) => show(pageOfTarget(target), { jump: true }),
      goToFraction: (fraction) => show(1 + fraction * (total - 1), { jump: true }),
      back: async () => {
        const previous = history.pop();
        if (previous === undefined) return;
        current = previous;
        if (isScroll()) {
          scrollToPage(current);
          emitPosition();
        } else {
          await render();
        }
      },
      canGoBack: () => history.length > 0,
      toc: () => toc,
      async search(query, onResult, signal) {
        const needle = query.toLocaleLowerCase();
        if (!needle) return;
        searchQuery = query;
        views.forEach(paintSearch);
        for (let n = 1; n <= total && !signal.aborted; n++) {
          const text = await textOf(n);
          const haystack = text.toLocaleLowerCase();
          for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
            onResult({
              target: String(n),
              section: `p. ${n}`,
              excerpt: {
                pre: (i > 40 ? "…" : "") + text.slice(Math.max(0, i - 40), i),
                match: text.slice(i, i + needle.length),
                post: text.slice(i + needle.length, i + needle.length + 40) + "…",
              },
            });
          }
        }
      },
      clearSearch: () => {
        searchQuery = null;
        views.forEach(paintSearch);
      },
      applySettings: (s) => {
        opts = { ...s };
        void render();
      },
      onSelect: (l) => void selectListeners.push(l),
      clearSelection: () => document.getSelection()?.removeAllRanges(),
      setHighlights(list) {
        highlights = new Map(list.map((h) => [h.location, h]));
        views.forEach(paintHighlights);
      },
      onHighlightClick: (l) => void highlightListeners.push(l),
      // Link annotations inside PDFs are not rendered yet.
      onExternalLink: () => {},
      onRelocate: (l) => void listeners.push(l),
      destroy: () => {
        resize.disconnect();
        cancelAnimationFrame(frame);
        cancelAnimationFrame(scrollFrame);
        clearViews();
        void loading.destroy();
        wrapper.remove();
      },
    };
  },
};
