import { h } from "./dom";

export type MenuItem =
  | "separator"
  | {
      label: string;
      action?: () => void | Promise<void>;
      /** Opens a second menu in the same place instead of running an action. */
      submenu?: MenuItem[];
      danger?: boolean;
      disabled?: boolean;
    };

let current: { el: HTMLElement; dispose: () => void } | null = null;

export function closeMenu(): void {
  current?.dispose();
  current = null;
}

/** Shows a floating menu at (x, y), kept inside the viewport. */
export function openMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const buttons: HTMLButtonElement[] = [];
  const el = h(
    "div",
    { class: "menu", role: "menu" },
    ...items.map((item) => {
      if (item === "separator") return h("hr", {});
      const button = h(
        "button",
        {
          role: "menuitem",
          class: item.danger ? "danger" : undefined,
          disabled: item.disabled,
          onclick: () => {
            if (item.submenu) return openMenu(x, y, item.submenu);
            closeMenu();
            void item.action?.();
          },
        },
        item.label,
        item.submenu ? h("span", { class: "muted" }, "›") : null,
      );
      buttons.push(button);
      return button;
    }),
  );
  document.body.append(el);

  const { width, height } = el.getBoundingClientRect();
  el.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;

  const onPointer = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) closeMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") closeMenu();
    else if (e.key === "ArrowDown") enabled[(index + 1) % enabled.length]?.focus();
    else if (e.key === "ArrowUp") enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Defer so the click that opened the menu does not close it.
  setTimeout(() => document.addEventListener("pointerdown", onPointer, true));
  document.addEventListener("keydown", onKey, true);
  buttons.find((b) => !b.disabled)?.focus();

  current = {
    el,
    dispose: () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      el.remove();
    },
  };
}

export function openMenuAt(anchor: HTMLElement, items: MenuItem[]): void {
  const r = anchor.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, items);
}
