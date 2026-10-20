import { t } from "../i18n";
import { SUPPORT } from "../support";
import { h } from "./dom";
import { openExternal } from "./external";
import { icon } from "./icons";
import { externalLinkDialog } from "./secure-dialogs";

/** "Support Noctua": voluntary donations, never required for any feature. */
export function openSupportDialog(): void {
  const copyButton = h("button", { type: "button" }, icon("copy"), h("span", {}, t("copy")));
  const copyStatus = h("span", { class: "muted", role: "status" });
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT.binanceId);
      copyStatus.textContent = t("copied");
    } catch {
      copyStatus.textContent = t("copyFailed");
    }
  });

  const dialog: HTMLDialogElement = h(
    "dialog",
    { class: "modal secure-modal support-modal", "aria-labelledby": "support-title", "aria-describedby": "support-desc" },
    h(
      "div",
      { class: "support-body" },
      h("div", { class: "modal-heading" }, icon("heart"), h("h2", { id: "support-title" }, t("supportTitle"))),
      h("p", { id: "support-desc" }, t("supportIntro")),
      h(
        "section",
        { class: "support-option", "aria-labelledby": "support-card" },
        h("h3", { id: "support-card" }, t("supportCardTitle")),
        h("p", { class: "muted" }, t("supportCardHint")),
        h(
          "button",
          {
            class: "primary",
            onclick: async () => {
              if (await externalLinkDialog(SUPPORT.zinli)) await openExternal(SUPPORT.zinli);
            },
          },
          icon("external"),
          h("span", {}, t("supportCardButton")),
        ),
      ),
      h(
        "section",
        { class: "support-option", "aria-labelledby": "support-binance" },
        h("h3", { id: "support-binance" }, t("supportBinanceTitle")),
        h("p", { class: "muted" }, t("supportBinanceHint")),
        h(
          "div",
          { class: "support-id" },
          h("span", { class: "muted" }, t("supportBinanceLabel")),
          h("code", {}, SUPPORT.binanceId),
          copyButton,
          copyStatus,
        ),
      ),
      h("p", { class: "muted" }, t("supportFree")),
      h(
        "div",
        { class: "modal-actions" },
        h("button", { type: "button", onclick: (e: Event) => (e.target as HTMLElement).closest("dialog")!.close() }, t("close")),
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
