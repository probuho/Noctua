import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FormatPlugin, ReadingPosition, TocItem } from "./types";

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

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-view";
    const spread = document.createElement("div");
    spread.className = "pdf-spread";
    wrapper.append(spread);
    container.append(wrapper);

    const listeners: Array<(p: ReadingPosition) => void> = [];
    const history: number[] = [];
    const pageText = new Map<number, string>();
    let current = clampPage(Number(location) || 1);
    let opts = { ...settings };
    let tasks: RenderTask[] = [];
    let generation = 0;

    function clampPage(n: number): number {
      return Math.min(Math.max(Math.round(n), 1), total);
    }

    const pagesShown = () => (opts.layout === "double" && current < total ? 2 : 1);

    const render = async () => {
      const gen = ++generation;
      tasks.forEach((t) => t.cancel());
      tasks = [];
      wrapper.dataset.theme = opts.theme;
      wrapper.dataset.fit = opts.pdfFit;

      const numbers = pagesShown() === 2 ? [current, current + 1] : [current];
      const pages = await Promise.all(numbers.map((n) => pdf.getPage(n)));
      if (gen !== generation) return;

      // Fit all shown pages side by side, then apply the zoom factor.
      const bases = pages.map((p) => p.getViewport({ scale: 1 }));
      const width = bases.reduce((sum, b) => sum + b.width, 0);
      const height = Math.max(...bases.map((b) => b.height));
      const byWidth = wrapper.clientWidth / width;
      const fit = opts.pdfFit === "width" ? byWidth : Math.min(byWidth, wrapper.clientHeight / height);
      // Leave a small margin so the page never triggers scrollbars at 100%.
      const scale = 0.96 * fit * (opts.fontSize / 100);
      const ratio = window.devicePixelRatio || 1;

      const canvases = pages.map((page) => {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        tasks.push(
          page.render({
            canvas,
            canvasContext: canvas.getContext("2d")!,
            viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
          }),
        );
        return canvas;
      });
      spread.replaceChildren(...canvases);
      wrapper.scrollTop = 0;

      const last = numbers[numbers.length - 1];
      const position: ReadingPosition = {
        location: String(current),
        progress: last / total,
        label: numbers.length === 2 ? `${current}–${last} / ${total}` : `${current} / ${total}`,
        page: { current, total },
      };
      listeners.forEach((l) => l(position));

      try {
        await Promise.all(tasks.map((t) => t.promise));
      } catch (err) {
        if ((err as Error)?.name !== "RenderingCancelledException") throw err;
      }
    };

    const show = async (n: number, { jump }: { jump: boolean }) => {
      const next = clampPage(n);
      if (next === current) return;
      if (jump) history.push(current);
      current = next;
      await render();
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
      capabilities: { reflowable: false, pages: true, fit: true },
      next: () => show(current + pagesShown(), { jump: false }),
      prev: () => show(current - (opts.layout === "double" ? 2 : 1), { jump: false }),
      goTo: (target) => show(Number(target), { jump: true }),
      goToFraction: (fraction) => show(1 + fraction * (total - 1), { jump: true }),
      back: async () => {
        const previous = history.pop();
        if (previous !== undefined) {
          current = previous;
          await render();
        }
      },
      canGoBack: () => history.length > 0,
      toc: () => toc,
      async search(query, onResult, signal) {
        const needle = query.toLocaleLowerCase();
        if (!needle) return;
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
      // Matches are not highlighted on the page yet (no text layer).
      clearSearch: () => {},
      applySettings: (s) => {
        opts = { ...s };
        void render();
      },
      onRelocate: (l) => void listeners.push(l),
      destroy: () => {
        resize.disconnect();
        cancelAnimationFrame(frame);
        tasks.forEach((t) => t.cancel());
        void loading.destroy();
        wrapper.remove();
      },
    };
  },
};
