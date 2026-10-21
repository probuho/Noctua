import { listen } from "@tauri-apps/api/event";
import { api, loadBookFile, type AddResult, type Book } from "../api";
import { getFormat } from "../formats";
import { t } from "../i18n";
import { soundEnabled } from "./app-settings";
import { blobToThumbnail, h } from "./dom";
import { icon } from "./icons";

/** Books read in parallel for titles and covers: fast without freezing the window. */
const WORKERS = 4;

/** Reads title, author and cover through the format plugin and stores them. */
export async function enrichMetadata(book: Book): Promise<void> {
  try {
    const meta = await getFormat(book.format).extractMetadata(await loadBookFile(book));
    const cover = meta.cover ? await blobToThumbnail(meta.cover) : undefined;
    await api.setExtractedMetadata(book.id, { title: meta.title, author: meta.author, cover });
  } catch (err) {
    console.warn(`Metadata extraction failed for ${book.path}`, err);
  }
}

/** Short two-note chime made with Web Audio (no sound file needed). */
export function playDoneSound(): void {
  try {
    const ctx = new AudioContext();
    const start = ctx.currentTime + 0.02;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = start + i * 0.16;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* No audio device: the visual notice is still shown. */
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return t("durationSeconds", String(s));
  const m = Math.round(s / 60);
  if (m < 60) return t("durationMinutes", String(m));
  return t("durationHours", String(Math.floor(m / 60)), String(m % 60));
}

let running = false;

/**
 * Adds files or folders with visible progress: scanning, then reading titles
 * and covers with an estimated time left. The panel can be sent to the
 * background (a small card in the corner) or cancelled; a chime sounds at
 * the end. `onChange` is called as books appear so the library can refresh.
 */
export async function importWithProgress(paths: string[], onChange: () => Promise<void> | void): Promise<AddResult | null> {
  if (running) {
    document.querySelector<HTMLDialogElement>("dialog.import-panel")?.classList.remove("mini");
    return null;
  }
  running = true;
  let cancelled = false;
  const startedAt = performance.now();

  const title = h("h2", { id: "import-title" }, t("importTitle"));
  const phase = h("p", { class: "import-phase", role: "status" }, t("importScanning"));
  const bar = h("progress", { class: "import-bar", max: 1, "aria-labelledby": "import-title" }) as HTMLProgressElement;
  bar.removeAttribute("value"); // indeterminate while scanning
  const counts = h("p", { class: "import-counts muted" });
  const eta = h("p", { class: "import-eta muted" });
  const backgroundBtn = h("button", { type: "button" }, t("importBackground"));
  const cancelBtn = h("button", { type: "button", class: "danger" }, t("cancel"));
  const closeBtn = h("button", { type: "button", class: "primary", hidden: true }, t("close"));
  const expandBtn = h("button", { type: "button", class: "import-expand", "aria-label": t("importShow"), title: t("importShow") }, icon("maximize"));

  const dialog = h(
    "dialog",
    { class: "modal import-panel", "aria-labelledby": "import-title" },
    h("div", { class: "import-head" }, h("span", { class: "import-icon" }, icon("library")), title, expandBtn),
    phase,
    bar,
    counts,
    eta,
    h("div", { class: "modal-actions" }, cancelBtn, backgroundBtn, closeBtn),
  ) as HTMLDialogElement;
  // Esc sends it to the background instead of hiding the progress.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!closeBtn.hidden) dialog.close();
    else toBackground();
  });
  const toBackground = () => {
    dialog.close();
    dialog.classList.add("mini");
    dialog.show();
  };
  const toForeground = () => {
    dialog.close();
    dialog.classList.remove("mini");
    dialog.showModal();
  };
  backgroundBtn.addEventListener("click", toBackground);
  expandBtn.addEventListener("click", toForeground);
  cancelBtn.addEventListener("click", () => {
    cancelled = true;
    cancelBtn.disabled = true;
    phase.textContent = t("importCancelling");
  });
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (!closeBtn.hidden) dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();

  const unlisten = await listen<number>("import-scan", (e) => {
    counts.textContent = t("importFound", String(e.payload));
  });

  let result: AddResult;
  try {
    result = await api.addBooks(paths);
  } catch (err) {
    unlisten();
    running = false;
    phase.textContent = String(err);
    cancelBtn.hidden = backgroundBtn.hidden = true;
    closeBtn.hidden = false;
    return null;
  } finally {
    unlisten();
  }
  await onChange();

  // Read titles and covers in parallel, with progress and time left.
  const total = result.added.length;
  let done = 0;
  const readStart = performance.now();
  bar.max = Math.max(1, total);
  bar.value = 0;
  const update = () => {
    phase.textContent = t("importReading");
    counts.textContent = t("importProgress", String(done), String(total));
    bar.value = done;
    if (done >= 3) {
      const perBook = (performance.now() - readStart) / done / 1000;
      eta.textContent = t("importEta", formatDuration(perBook * (total - done)));
    }
  };
  if (total) update();
  const queue = [...result.added];
  let sinceRefresh = 0;
  const worker = async () => {
    while (queue.length && !cancelled) {
      const book = queue.shift()!;
      await enrichMetadata(book);
      done++;
      update();
      if (++sinceRefresh >= 40) {
        sinceRefresh = 0;
        void onChange();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, total) }, worker));
  await onChange();

  const seconds = (performance.now() - startedAt) / 1000;
  const summary = [t("booksAdded", String(total))];
  if (result.duplicates.length) summary.push(t("duplicates", String(result.duplicates.length)));
  if (result.unsupported.length) summary.push(t("unsupported", String(result.unsupported.length)));
  title.textContent = cancelled ? t("importCancelled") : t("importDone");
  phase.textContent = summary.join(" · ");
  counts.textContent = cancelled ? t("importCancelledHint", String(total - done)) : t("importTook", formatDuration(seconds));
  eta.textContent = "";
  bar.value = bar.max;
  cancelBtn.hidden = backgroundBtn.hidden = true;
  closeBtn.hidden = false;
  if (dialog.classList.contains("mini")) setTimeout(() => dialog.open && dialog.close(), 10000);
  closeBtn.focus();
  if (soundEnabled()) playDoneSound();
  running = false;
  return result;
}
