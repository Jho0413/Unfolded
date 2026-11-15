// pdf.js, loaded only when a lesson has a paper (issue #98): the library and its worker are
// separate chunks, so the lesson page's own bundle doesn't grow.
type Pdfjs = typeof import("pdfjs-dist");

let pdfjs: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
    return lib;
  });
  return pdfjs;
}
