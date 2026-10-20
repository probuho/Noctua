// Accessible modals for two security-sensitive moments: unlocking a
// password-protected book and leaving the app through an external link.
// Built on the native <dialog> (focus trap, Esc to cancel, inert background).
import { t } from "../i18n";
import { h } from "./dom";
import { icon } from "./icons";

let uid = 0;

/** Opens a modal and resolves with whatever `onClose` returns. */
function modal<T>(build: (dialog: HTMLDialogElement, ids: { title: string; desc: string }) => Node[], onClose: (dialog: HTMLDialogElement) => T): Promise<T> {
  const ids = { title: `modal-title-${++uid}`, desc: `modal-desc-${uid}` };
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "modal secure-modal", "aria-labelledby": ids.title, "aria-describedby": ids.desc });
    dialog.append(...build(dialog, ids));
    dialog.addEventListener("close", () => {
      const result = onClose(dialog);
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// --- Password -------------------------------------------------------------------

/**
 * Asks for a book's password. Paste and password managers are allowed
 * (WCAG 3.3.8); the password is never stored. Resolves to null on cancel.
 */
export function passwordDialog(bookName: string, wrongPassword: boolean): Promise<string | null> {
  const inputId = `pdf-password-${++uid}`;
  const errorId = `pdf-password-error-${uid}`;
  const input = h("input", {
    id: inputId,
    type: "password",
    autocomplete: "current-password",
    required: true,
    "aria-invalid": String(wrongPassword),
    "aria-describedby": wrongPassword ? errorId : undefined,
  });
  const show = h("input", {
    type: "checkbox",
    onchange: (e: Event) => (input.type = (e.target as HTMLInputElement).checked ? "text" : "password"),
  });

  return modal(
    (_dialog, ids) => [
      h(
        "form",
        { method: "dialog" },
        h("div", { class: "modal-heading" }, icon("lock"), h("h2", { id: ids.title }, t("passwordTitle"))),
        h("p", { id: ids.desc }, t("passwordIntro", bookName)),
        h("label", { for: inputId, class: "field-label" }, t("password")),
        input,
        wrongPassword
          ? h("p", { id: errorId, class: "field-error", role: "alert" }, icon("alert"), h("span", {}, t("passwordWrong")))
          : null,
        h("label", { class: "check-row" }, show, t("showPassword")),
        h("p", { class: "muted" }, t("passwordPrivacy")),
        h(
          "div",
          { class: "modal-actions" },
          // type="button": Enter in the field must submit "Open", not "Cancel".
          h("button", { type: "button", onclick: (e: Event) => (e.target as HTMLElement).closest("dialog")!.close("cancel") }, t("cancel")),
          h("button", { value: "ok", class: "primary" }, t("unlock")),
        ),
      ),
    ],
    (dialog) => {
      const value = input.value;
      input.value = "";
      return dialog.returnValue === "ok" && value ? value : null;
    },
  );
}

// --- External links ---------------------------------------------------------------

export interface LinkCheck {
  url: URL | null;
  /** Web links (http/https) are the only ones Noctua opens. */
  openable: boolean;
  warnings: string[];
}

/** Classifies a link and lists anything a reader should know before opening it. */
export function checkLink(raw: string): LinkCheck {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    return { url: null, openable: false, warnings: [t("linkInvalid")] };
  }
  const warnings: string[] = [];
  const web = url.protocol === "https:" || url.protocol === "http:";
  if (!web) warnings.push(t("linkBlockedScheme", url.protocol.replace(":", "")));
  if (url.protocol === "http:") warnings.push(t("linkNotHttps"));
  if (url.username || url.password) warnings.push(t("linkCredentials"));
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[")) warnings.push(t("linkIpAddress"));
  if (url.hostname.split(".").some((part) => part.startsWith("xn--"))) warnings.push(t("linkPunycode"));
  return { url, openable: web && !url.username && !url.password, warnings };
}

/**
 * Warns before leaving the app. "Cancel" is the default (focused) choice; the
 * full address and the domain are always shown. Resolves true to open it.
 */
export function externalLinkDialog(raw: string): Promise<boolean> {
  const check = checkLink(raw);
  const copy = h(
    "button",
    {
      type: "button",
      onclick: async () => {
        await navigator.clipboard?.writeText(raw).catch(() => {});
        copy.textContent = t("copied");
      },
    },
    t("copyLink"),
  );
  const cancel = h("button", { value: "cancel", autofocus: true }, t("cancel"));

  return modal(
    (_dialog, ids) => [
      h(
        "form",
        { method: "dialog" },
        h(
          "div",
          { class: "modal-heading" },
          icon(check.openable ? "external" : "alert"),
          h("h2", { id: ids.title }, check.openable ? t("linkTitle") : t("linkBlockedTitle")),
        ),
        h("p", { id: ids.desc }, check.openable ? t("linkIntro") : t("linkBlockedIntro")),
        check.url?.hostname ? h("p", { class: "link-domain" }, check.url.hostname) : null,
        h("p", { class: "link-url" }, raw),
        check.warnings.length
          ? h(
              "ul",
              { class: "link-warnings", "aria-label": t("linkWarnings") },
              ...check.warnings.map((w) => h("li", {}, icon("alert"), h("span", {}, w))),
            )
          : null,
        h(
          "div",
          { class: "modal-actions" },
          copy,
          cancel,
          check.openable ? h("button", { value: "open", class: "primary" }, t("openInBrowser")) : null,
        ),
      ),
    ],
    (dialog) => dialog.returnValue === "open",
  );
}
