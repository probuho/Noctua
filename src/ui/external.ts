import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a web page in the user's default browser, never inside the app. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  await openUrl(url);
}

const lang = navigator.language.split("-")[0] || "en";

export const lookups = {
  google: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  wikipedia: (q: string) => `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  translate: (q: string) =>
    `https://translate.google.com/?sl=auto&tl=${lang}&op=translate&text=${encodeURIComponent(q)}`,
};
