import { registerFormat } from "./registry";
import { epubPlugin } from "./epub";
import { pdfPlugin } from "./pdf";

// Built-in formats. New formats: add a plugin file and register it here, then
// add the matching entry to `src-tauri/src/formats.rs`.
registerFormat(epubPlugin);
registerFormat(pdfPlugin);

export * from "./registry";
export type * from "./types";
