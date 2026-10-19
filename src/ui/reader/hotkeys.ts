import { t } from "../../i18n";
import { h } from "../dom";

export type Action =
  | "next"
  | "prev"
  | "start"
  | "end"
  | "search"
  | "bookmark"
  | "contents"
  | "larger"
  | "smaller"
  | "resetSize"
  | "fullscreen"
  | "back"
  | "theme"
  | "layout"
  | "help"
  | "close";

interface Binding {
  keys: string[];
  action: Action;
  label: Parameters<typeof t>[0];
}

/** Single source for both the key handler and the help sheet. */
const BINDINGS: Binding[] = [
  { keys: ["ArrowRight", "PageDown", " "], action: "next", label: "keyNextPrev" },
  { keys: ["ArrowLeft", "PageUp"], action: "prev", label: "keyNextPrev" },
  { keys: ["Home"], action: "start", label: "keyStartEnd" },
  { keys: ["End"], action: "end", label: "keyStartEnd" },
  { keys: ["Ctrl+f"], action: "search", label: "keySearch" },
  { keys: ["Ctrl+b"], action: "bookmark", label: "keyBookmark" },
  { keys: ["Ctrl+t"], action: "contents", label: "keyContents" },
  { keys: ["Ctrl+=", "Ctrl++"], action: "larger", label: "keySize" },
  { keys: ["Ctrl+-"], action: "smaller", label: "keySize" },
  { keys: ["Ctrl+0"], action: "resetSize", label: "keySizeReset" },
  { keys: ["F11"], action: "fullscreen", label: "keyFullscreen" },
  { keys: ["Alt+ArrowLeft", "Backspace"], action: "back", label: "keyBack" },
  { keys: ["t"], action: "theme", label: "keyTheme" },
  { keys: ["d"], action: "layout", label: "keyLayout" },
  { keys: ["?"], action: "help", label: "hotkeys" },
  { keys: ["Escape"], action: "close", label: "keyClose" },
];

function keyName(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey || e.metaKey) return `Ctrl+${key}`;
  if (e.altKey) return `Alt+${key}`;
  return key;
}

export function actionFor(e: KeyboardEvent): Action | null {
  const target = e.target as HTMLElement | null;
  // Only text entry swallows shortcuts; sliders and buttons must not.
  const typing = target?.closest?.(
    'input:not([type]), input[type="text"], input[type="search"], input[type="number"], select, textarea',
  );
  const name = keyName(e);
  if (typing && name !== "Escape") return null;
  return BINDINGS.find((b) => b.keys.includes(name))?.action ?? null;
}

const pretty = (key: string) =>
  (({ ArrowRight: "→", ArrowLeft: "←", " ": "␣", PageDown: "PgDn", PageUp: "PgUp", Escape: "Esc" }) as Record<string, string>)[key] ?? key;

export function hotkeySheet(): HTMLElement {
  const rows = new Map<string, string[]>();
  for (const b of BINDINGS) rows.set(b.label, [...(rows.get(b.label) ?? []), ...b.keys.map(pretty)]);
  return h(
    "dl",
    { class: "hotkeys" },
    ...[...rows].flatMap(([label, keys]) => [
      h("dt", {}, ...keys.map((k) => h("kbd", {}, k))),
      h("dd", {}, t(label as Parameters<typeof t>[0])),
    ]),
  );
}
