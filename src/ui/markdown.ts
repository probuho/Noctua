import { h } from "./dom";

/**
 * Small Markdown renderer for the reading journal. It builds DOM nodes
 * directly (never innerHTML), so a journal file cannot inject markup or
 * scripts. It covers what people write in a journal: headings, paragraphs,
 * lists, quotes, code, rules, bold/italic, links and images, including
 * Obsidian's `![[image.png]]` embeds.
 */
export interface MarkdownHooks {
  /** Loads a local image (path relative to the journal folder). */
  image: (src: string, img: HTMLImageElement) => void;
  /** Opens a web link (the caller shows the safety warning). */
  link: (url: string) => void;
  /** Jumps to a reading position saved with `positionMarker`. */
  position: (location: string) => void;
  /** Text of the "go to position" button. */
  positionLabel: string;
}

const POSITION = /^<!--\s*noctua:pos=(\S+)\s*-->$/;

/** Hidden marker (an HTML comment, invisible in Obsidian) linking a section to a book position. */
export const positionMarker = (location: string) => `<!-- noctua:pos=${encodeURIComponent(location)} -->`;

/** Removes YAML front matter (Obsidian properties). */
export function stripFrontMatter(md: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

const INLINE =
  /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(<?([^)\s>]+)>?\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;

function inline(text: string, hooks: MarkdownHooks): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    last = m.index! + m[0].length;
    if (m[1] !== undefined) {
      // Obsidian embed: a bare name is looked up in attachments/.
      const name = m[1].trim();
      out.push(image(name.includes("/") ? name : `attachments/${name}`, name, hooks));
    } else if (m[3] !== undefined) out.push(image(m[3], m[2] ?? "", hooks));
    else if (m[5] !== undefined) {
      const url = m[5];
      out.push(
        /^https?:\/\//i.test(url)
          ? h("a", { href: url, onclick: (e: Event) => (e.preventDefault(), hooks.link(url)) }, ...inline(m[4], hooks))
          : h("span", {}, ...inline(m[4], hooks)),
      );
    } else if (m[6] !== undefined || m[7] !== undefined) out.push(h("strong", {}, ...inline(m[6] ?? m[7], hooks)));
    else if (m[8] !== undefined) out.push(h("code", {}, m[8]));
    else out.push(h("em", {}, ...inline(m[9] ?? m[10], hooks)));
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

function image(src: string, alt: string, hooks: MarkdownHooks): Node {
  const img = h("img", { alt, loading: "lazy" }) as HTMLImageElement;
  // Remote images are not loaded: the journal works offline and leaks nothing.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return document.createTextNode(alt || src);
  try {
    hooks.image(decodeURI(src), img);
  } catch {
    hooks.image(src, img);
  }
  return img;
}

export function renderMarkdown(md: string, hooks: MarkdownHooks): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = stripFrontMatter(md).replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|>|```|\s*([-*+]|\d+[.)])\s|(\*\s*){3,}$|(-\s*){3,}$)/.test(l) || POSITION.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const pos = POSITION.exec(trimmed);
    if (pos) {
      let location = pos[1];
      try {
        location = decodeURIComponent(location);
      } catch {
        /* keep raw */
      }
      frag.append(h("button", { type: "button", class: "link-button md-position", onclick: () => hooks.position(location) }, hooks.positionLabel));
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      frag.append(h(`h${Math.min(6, heading[1].length + 2)}` as "h3", { class: "md-h" }, ...inline(heading[2], hooks)));
      i++;
      continue;
    }
    if (/^((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(trimmed)) {
      frag.append(h("hr", {}));
      i++;
      continue;
    }
    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      frag.append(h("pre", {}, h("code", {}, code.join("\n"))));
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      frag.append(h("blockquote", {}, renderMarkdown(quote.join("\n"), hooks)));
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    const first = listItem.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1]);
      const list = h(ordered ? "ol" : "ul", {});
      while (i < lines.length) {
        const m = listItem.exec(lines[i]);
        if (!m) break;
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[2]);
        list.append(
          h(
            "li",
            {},
            task ? h("input", { type: "checkbox", disabled: true, checked: task[1] !== " ", "aria-hidden": "true" }) : null,
            ...inline(task ? task[2] : m[2], hooks),
          ),
        );
        i++;
      }
      frag.append(list);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) para.push(lines[i++]);
    const p = h("p", {});
    para.forEach((l, n) => {
      if (n) p.append(h("br", {}));
      p.append(...inline(l.trim(), hooks));
    });
    frag.append(p);
  }
  return frag;
}
