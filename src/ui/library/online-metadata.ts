import { api, type MetadataCandidate } from "../../api";
import { t } from "../../i18n";
import { h } from "../dom";
import { icon } from "../icons";

interface Deps {
  /** Current title and author typed in the form. */
  query: () => { title: string; author: string | null };
  /** Fills the form fields (they are saved with "Save", like manual edits). */
  useData: (data: { title: string; author: string | null; description: string | null }) => void;
  /** Sets the cover right away, like "Change cover". */
  useCover: (image: Blob) => Promise<void>;
}

/**
 * "Find online" for the book properties: looks up title, author, description
 * and cover in Open Library. Nothing is sent until the user presses Search.
 */
export function createOnlineLookup({ query, useData, useCover }: Deps) {
  const status = h("p", { class: "muted", role: "status" });
  const results = h("ul", { class: "ol-results", "aria-label": t("onlineResults") });
  const urls: string[] = [];

  const coverThumb = (c: MetadataCandidate) => {
    const box = h("div", { class: "ol-cover" }, h("span", {}, t("noCover")));
    if (c.coverId !== null) {
      api
        .metadataCover(c.coverId, "M")
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          urls.push(url);
          box.replaceChildren(h("img", { src: url, alt: "" }));
        })
        .catch(() => {});
    }
    return box;
  };

  const row = (c: MetadataCandidate) => {
    const author = c.authors.join(", ") || null;
    const details = [c.year, c.publisher, c.languages.slice(0, 3).join(", ").toUpperCase()].filter(Boolean).join(" · ");
    const titleId = `ol-${c.key.replace(/\W/g, "")}`;
    const useDataButton = h("button", { type: "button", "aria-describedby": titleId }, t("useData"));
    useDataButton.addEventListener("click", async () => {
      useDataButton.disabled = true;
      status.textContent = t("onlineLoading");
      const description = await api.metadataDescription(c.key).catch(() => null);
      useData({ title: c.title, author, description });
      status.textContent = description ? t("dataApplied") : t("dataAppliedNoDescription");
      useDataButton.disabled = false;
    });
    const useCoverButton = h("button", { type: "button", "aria-describedby": titleId }, t("useCover"));
    useCoverButton.hidden = c.coverId === null;
    useCoverButton.addEventListener("click", async () => {
      useCoverButton.disabled = true;
      status.textContent = t("onlineLoading");
      try {
        const bytes = await api.metadataCover(c.coverId!, "L");
        await useCover(new Blob([bytes], { type: "image/jpeg" }));
        status.textContent = t("coverApplied");
      } catch (err) {
        status.textContent = `${t("onlineError")} ${String(err)}`;
      } finally {
        useCoverButton.disabled = false;
      }
    });
    return h(
      "li",
      { class: "ol-item" },
      coverThumb(c),
      h(
        "div",
        { class: "ol-text" },
        h("strong", { id: titleId }, c.title),
        author ? h("span", {}, author) : null,
        details ? h("span", { class: "muted" }, details) : null,
        h("div", { class: "ol-actions" }, useDataButton, useCoverButton),
      ),
    );
  };

  const searchButton = h("button", { type: "button" }, icon("search"), h("span", {}, t("searchOnline")));
  searchButton.addEventListener("click", async () => {
    const { title, author } = query();
    if (!title.trim()) {
      status.textContent = t("onlineNeedTitle");
      return;
    }
    searchButton.disabled = true;
    status.textContent = t("onlineSearching");
    results.replaceChildren();
    try {
      const found = await api.metadataSearch(title, author);
      status.textContent = found.length ? t("onlineFound", String(found.length)) : t("onlineNone");
      results.replaceChildren(...found.map(row));
    } catch (err) {
      status.textContent = `${t("onlineError")} ${String(err)}`;
    } finally {
      searchButton.disabled = false;
    }
  });

  const el = h(
    "section",
    { class: "online-lookup", "aria-labelledby": "online-lookup-title" },
    h("h3", { id: "online-lookup-title" }, t("onlineTitle")),
    h("p", { class: "muted" }, t("onlineHint")),
    searchButton,
    status,
    results,
  );

  return { el, destroy: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
