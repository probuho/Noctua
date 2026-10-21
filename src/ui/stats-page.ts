import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { t } from "../i18n";
import { loadSummary, type ReadingSummary } from "../stats";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { formatDuration } from "./import-progress";
import { supportCard } from "./support-dialog";

type Period = 7 | 30 | 365 | 0;
const PERIODS: Array<{ days: Period; label: Parameters<typeof t>[0] }> = [
  { days: 7, label: "periodWeek" },
  { days: 30, label: "periodMonth" },
  { days: 365, label: "periodYear" },
  { days: 0, label: "periodAll" },
];
const FORMAT_COLORS = ["var(--accent)", "var(--terracotta)", "#7FA7D9", "#8CC6A0", "#B39DDB"];
const hoursNum = (s: number) => (s / 3600).toLocaleString(navigator.language, { maximumFractionDigits: 1 });
/** Under an hour, minutes read better than "0,1 h". */
const hours = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${hoursNum(s)} h`);
const weekday = new Intl.DateTimeFormat(navigator.language, { weekday: "narrow" });
const shortDate = new Intl.DateTimeFormat(navigator.language, { day: "numeric", month: "short" });

/** "Estadísticas": reading time measured while books are open (nothing estimated). */
export async function renderStats(container: HTMLElement, period: Period = 7): Promise<void> {
  const { summary, books } = await loadSummary(period);
  const live = books.filter((b) => b.deletedAt === null);
  const finished = live.filter((b) => b.readAt !== null);
  const reading = live.filter((b) => b.progress > 0 && b.readAt === null);
  const rerender = (p: Period) => void renderStats(container, p);

  const sidebar = h(
    "aside",
    { class: "side-nav" },
    h("div", { class: "side-head" }, h("h2", {}, t("navStats")), h("p", {}, t("statsSummary"))),
    h("p", { class: "side-label" }, t("period")),
    h(
      "ul",
      { class: "side-list" },
      ...PERIODS.map((p) =>
        h("li", {}, h("button", { type: "button", "aria-current": p.days === period ? "true" : undefined, onclick: () => rerender(p.days) }, h("span", {}, t(p.label)))),
      ),
    ),
    h("p", { class: "side-label" }, t("byBook")),
    h(
      "ul",
      { class: "side-list" },
      ...(summary.perBook.length
        ? summary.perBook.slice(0, 8).map((x) => h("li", {}, h("div", { class: "side-row" }, h("span", {}, x.book.title), h("span", { class: "count" }, hours(x.seconds)))))
        : [h("li", { class: "side-empty" }, t("noReadingYet"))]),
    ),
    h("div", { class: "side-bottom" }, supportCard()),
  );

  const streak = h(
    "section",
    { class: "streak-banner", "aria-label": t("readingStreak") },
    h(
      "div",
      {},
      h("p", { class: "sb-label" }, icon("flame"), t("readingStreak")),
      h("p", { class: "sb-value" }, summary.streak === 1 ? t("streakDay") : t("streakDays", String(summary.streak))),
      h("p", { class: "sb-sub" }, summary.streak && summary.streak >= summary.bestStreak ? t("bestStreakNow") : t("bestStreak", String(summary.bestStreak))),
    ),
    h(
      "div",
      { class: "sb-week", "aria-hidden": "true" },
      ...summary.week.map((read, i) => h("span", { class: "sb-day" }, h("span", { class: `sb-bar${read ? " on" : ""}` }), h("span", {}, "LMXJVSD"[i]))),
    ),
  );

  const statCard = (label: string, value: string, sub: string, iconName: IconName) =>
    h("section", { class: "stat-card" }, h("div", { class: "sc-top" }, h("p", {}, label), h("span", { class: "sc-icon" }, icon(iconName))), h("p", { class: "sc-value" }, value), h("p", { class: "sc-sub" }, sub));

  const perDay = period === 7 ? summary.perDay.map((d) => ({ ...d, label: dayLabel(d.day) })) : groupByWeek(summary, period);
  const max = Math.max(1, ...perDay.map((d) => d.seconds));
  const chart = h(
    "section",
    { class: "chart-card", "aria-labelledby": "chart-title" },
    h("div", { class: "cc-head" }, h("h2", { id: "chart-title" }, t("hoursPerDay")), h("p", { class: "muted" }, `${t(PERIODS.find((p) => p.days === period)!.label)} · ${summary.totalSeconds ? hours(summary.totalSeconds) : "0 min"}`)),
    h(
      "div",
      { class: "bars", role: "img", "aria-label": perDay.map((d) => `${d.label}: ${d.seconds ? hours(d.seconds) : "0"}`).join(", ") },
      ...perDay.map((d) =>
        h(
          "div",
          { class: "bar-col" },
          h("span", { class: "bar-value" }, d.seconds ? hours(d.seconds) : ""),
          h("span", { class: "bar", style: `height:${Math.max(d.seconds ? 4 : 0, (d.seconds / max) * 100)}%` }),
          h("span", { class: "bar-label" }, d.label),
        ),
      ),
    ),
  );

  const totalFormat = summary.perFormat.reduce((a, f) => a + f.seconds, 0) || 1;
  const top = summary.perFormat[0];
  const distribution = h(
    "section",
    { class: "chart-card dist-card", "aria-labelledby": "dist-title" },
    h("h2", { id: "dist-title" }, t("byFormat")),
    h("div", { class: "dist-bar", "aria-hidden": "true" }, ...summary.perFormat.map((f, i) => h("span", { style: `flex:${f.seconds};background:${FORMAT_COLORS[i % FORMAT_COLORS.length]}` }))),
    h(
      "ul",
      { class: "dist-legend" },
      ...(summary.perFormat.length
        ? summary.perFormat.map((f, i) =>
            h("li", {}, h("span", { class: "dot", style: `background:${FORMAT_COLORS[i % FORMAT_COLORS.length]}` }), h("span", {}, f.format.toUpperCase()), h("span", { class: "pct" }, `${Math.round((f.seconds / totalFormat) * 100)} %`)),
          )
        : [h("li", { class: "muted" }, t("noReadingYet"))]),
    ),
    top ? h("p", { class: "insight" }, icon("sparkles"), t("formatInsight", top.format.toUpperCase(), String(Math.round((top.seconds / totalFormat) * 100)))) : null,
  );

  const exportCsv = async () => {
    const path = await save({ defaultPath: "noctua-lectura.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    const log = await api.readingLog();
    const byId = new Map(live.map((b) => [b.id, b]));
    const csv = ["fecha,libro,formato,minutos", ...log.map((r) => [r.day, `"${(byId.get(r.bookId)?.title ?? "").replace(/"/g, '""')}"`, byId.get(r.bookId)?.format ?? "", (r.seconds / 60).toFixed(1)].join(","))].join("\n");
    await api.saveExport(path, csv);
  };

  container.replaceChildren(
    h(
      "div",
      { class: "page-with-side" },
      sidebar,
      h(
        "main",
        { class: "page stats-page" },
        h(
          "header",
          { class: "page-head" },
          h("div", {}, h("h1", {}, t("statsTitle")), h("p", { class: "muted" }, t("statsSub", formatDuration(summary.totalSeconds || 0)))),
          h(
            "div",
            { class: "page-actions" },
            h(
              "div",
              { class: "segmented", role: "radiogroup", "aria-label": t("period") },
              ...PERIODS.slice(0, 3).map((p) => h("button", { type: "button", role: "radio", "aria-checked": String(p.days === period), onclick: () => rerender(p.days) }, t(`${p.label}Short` as Parameters<typeof t>[0]))),
            ),
            h("button", { type: "button", class: "btn-outline", onclick: () => void exportCsv() }, icon("download"), h("span", {}, t("export"))),
          ),
        ),
        streak,
        h(
          "div",
          { class: "stat-cards" },
          statCard(t("booksReading"), String(reading.length), t("booksInLibrary", String(live.length)), "book-open"),
          statCard(t("booksFinished"), String(finished.length), t("finishedHint"), "book-check"),
          statCard(t("readingTime"), formatDuration(summary.totalSeconds || 0), t("thisWeek", formatDuration(summary.weekSeconds || 0)), "timer"),
        ),
        h("div", { class: "charts" }, chart, distribution),
      ),
    ),
  );
}

/** Longer periods are shown per week (or per month for "all time") so bars stay readable. */
function groupByWeek(summary: ReadingSummary, period: Period): Array<{ label: string; seconds: number; day: string }> {
  const days = summary.perDay;
  const size = period === 30 ? 1 : period === 365 ? 7 : Math.max(7, Math.ceil(days.length / 12));
  if (size === 1) return days.map((d) => ({ ...d, label: String(new Date(`${d.day}T12:00:00`).getDate()) }));
  const groups: Array<{ label: string; seconds: number; day: string }> = [];
  for (let i = 0; i < days.length; i += size) {
    const chunk = days.slice(i, i + size);
    groups.push({ day: chunk[0].day, label: shortDate.format(new Date(`${chunk[0].day}T12:00:00`)), seconds: chunk.reduce((a, d) => a + d.seconds, 0) });
  }
  return groups.slice(-14);
}

export function dayLabel(day: string): string {
  return weekday.format(new Date(`${day}T12:00:00`)).toUpperCase();
}
