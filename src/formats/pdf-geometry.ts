/**
 * Geometry helpers for PDF highlights. A PDF has no stable text anchors like
 * EPUB CFIs, so a highlight is stored as its page plus rectangles in PDF units
 * (viewport scale 1). That survives zoom, fit and single/double page changes.
 */

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PREFIX = "pdf:";

/** "pdf:<page>:x,y,w,h;x,y,w,h" */
export function encodeLocation(page: number, rects: PdfRect[]): string {
  const parts = rects.map((r) => [r.x, r.y, r.w, r.h].map((n) => Number(n.toFixed(2))).join(","));
  return `${PREFIX}${page}:${parts.join(";")}`;
}

export function decodeLocation(location: string): { page: number; rects: PdfRect[] } | null {
  if (!location.startsWith(PREFIX)) return null;
  const [page, body = ""] = location.slice(PREFIX.length).split(":");
  const rects = body
    .split(";")
    .map((part) => part.split(",").map(Number))
    .filter((n) => n.length === 4 && n.every(Number.isFinite))
    .map(([x, y, w, h]) => ({ x, y, w, h }));
  return Number(page) > 0 ? { page: Number(page), rects } : null;
}

/** Page number for any target: a plain page number or an encoded highlight. */
export function pageOfTarget(target: string): number {
  return decodeLocation(target)?.page ?? Number(target);
}

/**
 * Joins rectangles that sit on the same line and touch, so a highlight is a
 * few clean bars instead of one box per text span.
 */
export function mergeRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: PdfRect[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5;
    const touches = last && r.x <= last.x + last.w + Math.min(last.h, r.h) * 0.6;
    if (last && sameLine && touches) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x: Math.min(last.x, r.x), y: top, w: right - Math.min(last.x, r.x), h: bottom - top });
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Client rects of `range` that fall inside `pageEl`, in PDF units. */
export function rectsInPage(range: Range, pageEl: HTMLElement, scale: number): PdfRect[] {
  const page = pageEl.getBoundingClientRect();
  const rects: PdfRect[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const left = Math.max(r.left, page.left);
    const right = Math.min(r.right, page.right);
    const top = Math.max(r.top, page.top);
    const bottom = Math.min(r.bottom, page.bottom);
    if (right <= left || bottom <= top) continue;
    rects.push({ x: (left - page.left) / scale, y: (top - page.top) / scale, w: (right - left) / scale, h: (bottom - top) / scale });
  }
  return mergeRects(rects);
}

/**
 * Ranges for every case-insensitive occurrence of `query` in the text layer.
 * Text spans are joined with a space when neither side has one, matching how
 * search builds a page's text.
 */
export function textRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // For each character of the joined text: the node and offset it came from.
  const map: Array<[Text, number]> = [];
  let joined = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data;
    if (!text) continue;
    if (joined && !/\s$/.test(joined) && !/^\s/.test(text)) {
      const prev = map[map.length - 1];
      joined += " ";
      map.push([prev[0], prev[0].length]);
    }
    for (let i = 0; i < text.length; i++) map.push([node, i]);
    joined += text;
  }
  const haystack = joined.toLocaleLowerCase();
  const ranges: Range[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
    const [startNode, startOffset] = map[i];
    const [endNode, endOffset] = map[i + needle.length - 1];
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, Math.min(endOffset + 1, endNode.length));
    ranges.push(range);
  }
  return ranges;
}
