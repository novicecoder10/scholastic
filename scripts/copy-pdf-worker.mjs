// Copies pdf.js's worker into public/ so react-pdf can load it same-origin.
//
// The alternative every react-pdf example uses is a cdnjs/unpkg URL, which
// would make the reader silently unusable offline and add a third-party origin
// to a page that renders user-uploaded documents. Neither is acceptable here.
//
// The worker MUST match the pdfjs-dist version react-pdf resolves — pdf.js
// refuses a mismatched pair at runtime — so it is copied from the installed
// package rather than pinned by hand anywhere.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const source = join(pdfjsRoot, "build", "pdf.worker.min.mjs");
const destinationDir = join(process.cwd(), "public");
const destination = join(destinationDir, "pdf.worker.min.mjs");

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
console.log(`copied pdf.js worker → public/pdf.worker.min.mjs`);
