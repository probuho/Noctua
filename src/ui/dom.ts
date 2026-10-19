type Props = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny element factory: h("button", { class: "x", onclick: fn }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** Downscale an image blob to a JPEG data URL for library thumbnails. */
export async function blobToThumbnail(blob: Blob, maxHeight = 360): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxHeight / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
