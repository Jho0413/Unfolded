"use client";
// Loads the lesson's paper (issue #98): the PDF from GET /api/runs/<lessonId>/paper.pdf, and
// every page's size and text items, which player/paper/locate.ts searches. A lesson with no
// paper (404, or a PDF pdf.js can't read) is "missing": the lesson page has no paper pane.
import { useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PaperItem } from "./locate";
import { loadPdfjs } from "./pdf";

export type PaperPage = {
  proxy: PDFPageProxy;
  /** Size at scale 1, in PDF points. */
  width: number;
  height: number;
  /** For the text layer: its spans are `items`, in order. */
  textContent: TextContent;
  items: PaperItem[];
};

export type PaperDoc =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; pages: PaperPage[] };

/** The paper's URL in the run folder (served by GET /api/runs, like the audio and cover). */
export function paperUrl(lessonId: string): string {
  return `/api/runs/${lessonId}/paper.pdf`;
}

export function usePaperDoc(url: string): PaperDoc {
  const [doc, setDoc] = useState<{ url: string; doc: PaperDoc } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    const done = (next: PaperDoc) => {
      if (!cancelled) setDoc({ url, doc: next });
    };
    (async () => {
      const res = await fetch(url);
      if (!res.ok) {
        // No paper is normal for older runs: the whiteboard takes the whole stage.
        console.info(`[paper] no paper at ${url} (${res.status})`);
        return done({ status: "missing" });
      }
      const data = new Uint8Array(await res.arrayBuffer());
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      task = pdfjs.getDocument({ data });
      const pdf = await task.promise;
      const pages: PaperPage[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const proxy = await pdf.getPage(n);
        const { width, height } = proxy.getViewport({ scale: 1 });
        const textContent = await proxy.getTextContent();
        // The text layer makes one span per item with a `str`, in this order.
        const items = textContent.items
          .filter((i): i is TextItem => "str" in i)
          .map((i) => ({ str: i.str }));
        pages.push({ proxy, width, height, textContent, items });
        if (cancelled) return;
      }
      done({ status: "ready", pages });
    })().catch((err: unknown) => {
      console.error(`[paper] couldn't load ${url}`, err);
      done({ status: "missing" });
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);
  return doc !== null && doc.url === url ? doc.doc : { status: "loading" };
}
