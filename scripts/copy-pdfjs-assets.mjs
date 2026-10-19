// Copies the runtime assets PDF.js loads by URL (image decoders compiled to
// WebAssembly, CMaps, standard fonts, ICC profiles) into public/pdfjs so Vite
// serves them in dev and ships them in the build. Runs before dev/build.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
for (const dir of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${dest}`);
