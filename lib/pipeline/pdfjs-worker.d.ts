// pdfjs-dist ships no types for its worker module. lib/pipeline/paperPages.ts only hands it to
// pdf.js (globalThis.pdfjsWorker), which reads WorkerMessageHandler.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
