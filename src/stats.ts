import { api, type Book, type ReadingDay } from "./api";

/** Local date as "YYYY-MM-DD" (statistics follow the reader's calendar). */
export function dayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Counts active reading time while a book is open: only while the window is
 * visible and the reader did something (turned a page, scrolled, typed) in
 * the last three minutes. Saved every 30 seconds and when the book closes.
 */
export function trackReading(bookId: number): { activity: () => void; stop: () => Promise<void> } {
  const IDLE_MS = 3 * 60 * 1000;
  let lastActivity = Date.now();
  let lastTick = Date.now();
  let pending = 0;
  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === "visible" && now - lastActivity < IDLE_MS) pending += (now - lastTick) / 1000;
    lastTick = now;
  };
  const flush = async () => {
    tick();
    const seconds = Math.floor(pending);
    if (seconds < 1) return;
    pending -= seconds;
    await api.logReading(bookId, dayKey(), seconds).catch(() => {});
  };
  const timer = window.setInterval(() => void flush(), 30000);
  const activity = () => {
    tick();
    lastActivity = Date.now();
  };
  ["keydown", "pointerdown", "wheel"].forEach((e) => window.addEventListener(e, activity, { passive: true }));
  return {
    activity,
    stop: async () => {
      window.clearInterval(timer);
      ["keydown", "pointerdown", "wheel"].forEach((e) => window.removeEventListener(e, activity));
      await flush();
    },
  };
}

export interface ReadingSummary {
  /** Consecutive days with reading, ending today (or yesterday if not read yet today). */
  streak: number;
  /** Best streak ever. */
  bestStreak: number;
  /** Monday→Sunday of the current week: whether there was reading. */
  week: boolean[];
  /** Seconds per day for the last `days` days, oldest first. */
  perDay: Array<{ day: string; seconds: number }>;
  totalSeconds: number;
  weekSeconds: number;
  perBook: Array<{ book: Book; seconds: number }>;
  perFormat: Array<{ format: string; seconds: number }>;
  /** Seconds of reading per 1.0 of progress, for "time left" estimates (null without data). */
  secondsPerBook: number | null;
}

/** Summarizes the reading log for the last `days` days (0 = all time). */
export function summarize(log: ReadingDay[], books: Book[], days = 7): ReadingSummary {
  const byId = new Map(books.map((b) => [b.id, b]));
  const daySeconds = new Map<string, number>();
  for (const r of log) daySeconds.set(r.day, (daySeconds.get(r.day) ?? 0) + r.seconds);

  const today = new Date();
  let streak = 0;
  for (let d = daySeconds.has(dayKey(today)) ? today : addDays(today, -1); daySeconds.has(dayKey(d)); d = addDays(d, -1)) streak++;
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of [...daySeconds.keys()].sort()) {
    run = prev && dayKey(addDays(new Date(`${prev}T12:00:00`), 1)) === day ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = day;
  }
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => daySeconds.has(dayKey(addDays(monday, i))));
  const weekSeconds = Array.from({ length: 7 }, (_, i) => daySeconds.get(dayKey(addDays(monday, i))) ?? 0).reduce((a, b) => a + b, 0);

  const from = days ? dayKey(addDays(today, -(days - 1))) : "";
  const inRange = log.filter((r) => r.day >= from);
  const span = days || Math.max(1, Math.min(366, daySeconds.size));
  const perDay = Array.from({ length: days || span }, (_, i) => {
    const key = dayKey(addDays(today, -((days || span) - 1 - i)));
    return { day: key, seconds: daySeconds.get(key) ?? 0 };
  });
  const bookTotals = new Map<number, number>();
  const formatTotals = new Map<string, number>();
  for (const r of inRange) {
    bookTotals.set(r.bookId, (bookTotals.get(r.bookId) ?? 0) + r.seconds);
    const book = byId.get(r.bookId);
    if (book) formatTotals.set(book.format, (formatTotals.get(book.format) ?? 0) + r.seconds);
  }
  const perBook = [...bookTotals]
    .flatMap(([id, seconds]) => (byId.has(id) ? [{ book: byId.get(id)!, seconds }] : []))
    .sort((a, b) => b.seconds - a.seconds);
  const perFormat = [...formatTotals].map(([format, seconds]) => ({ format, seconds })).sort((a, b) => b.seconds - a.seconds);

  // Reading speed: total time over total progress of books with real progress.
  let time = 0;
  let progress = 0;
  const allBookTotals = new Map<number, number>();
  for (const r of log) allBookTotals.set(r.bookId, (allBookTotals.get(r.bookId) ?? 0) + r.seconds);
  for (const [id, seconds] of allBookTotals) {
    const p = byId.get(id)?.progress ?? 0;
    if (p > 0.02 && seconds > 120) {
      time += seconds;
      progress += p;
    }
  }
  return {
    streak,
    bestStreak,
    week,
    perDay,
    totalSeconds: inRange.reduce((a, r) => a + r.seconds, 0),
    weekSeconds,
    perBook,
    perFormat,
    secondsPerBook: progress > 0.05 ? time / progress : null,
  };
}

export async function loadSummary(days = 7): Promise<{ summary: ReadingSummary; books: Book[] }> {
  const [log, books] = await Promise.all([api.readingLog(), api.listBooks()]);
  return { summary: summarize(log, books, days), books };
}
