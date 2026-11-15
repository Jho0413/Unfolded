// lib/pipeline/paperPages.ts (issue #98, ARCHITECTURE.md section 5.1): the paper's page text,
// extracted with pdf.js as the paper viewer reads it, and cached in paper-text.json. The PDFs
// are made on the fly (the e2e paper fixture, and a text-less one); runs go to a temp dir.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractPageTexts,
  PaperText,
  readPaperPages,
} from "@/lib/pipeline/paperPages";
import {
  PAPER_PDF_FILE,
  PAPER_TEXT_FILE,
  readRunJson,
  writeRunFile,
  writeRunJson,
} from "@/lib/runs/store";
import { findQuote } from "@/shared/paperText";
import { PAPER_PAGES, paperPdf } from "../../../e2e/support/paperPdf";
import { makePdf } from "./pdfs";

const dirs = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return dirs.runs;
      },
    },
  };
});

beforeEach(async () => {
  dirs.runs = await mkdtemp(path.join(tmpdir(), "paper-pages-"));
});
afterEach(async () => {
  await rm(dirs.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const LESSON = "lesson-1";
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("extractPageTexts", () => {
  it("each page's text items joined in order, page 1 first, as the viewer joins them", async () => {
    const pages = await extractPageTexts(new Uint8Array(paperPdf()));
    expect(pages).toEqual(PAPER_PAGES.map((lines) => lines.join("")));
    // A quote across a line break and a hyphenated word is found, as the viewer finds it.
    expect(
      findQuote(
        pages[1],
        "The products of the paired entries are added together",
      ),
    ).not.toBeNull();
  });

  it("bytes pdf.js can't read: throws", async () => {
    await expect(
      extractPageTexts(new TextEncoder().encode("not a pdf")),
    ).rejects.toThrow();
  });
});

describe("readPaperPages", () => {
  it("no paper.pdf (a run made before #98): undefined, nothing logged", async () => {
    const error = vi.spyOn(console, "error");
    await expect(readPaperPages(LESSON)).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it("a paper.pdf: its pages, saved in paper-text.json with the PDF's sha256", async () => {
    const pdf = new Uint8Array(paperPdf());
    await writeRunFile(LESSON, PAPER_PDF_FILE, pdf);
    const pages = await readPaperPages(LESSON);
    expect(pages).toEqual(PAPER_PAGES.map((lines) => lines.join("")));
    await expect(
      readRunJson(LESSON, PAPER_TEXT_FILE, PaperText),
    ).resolves.toEqual({ pdfSha256: sha256(pdf), pages });
  });

  it("paper-text.json for this paper.pdf: read, not extracted again", async () => {
    const pdf = new Uint8Array(paperPdf());
    await writeRunFile(LESSON, PAPER_PDF_FILE, pdf);
    const cached = ["cached page one", "cached page two"];
    await writeRunJson(LESSON, PAPER_TEXT_FILE, {
      pdfSha256: sha256(pdf),
      pages: cached,
    });
    await expect(readPaperPages(LESSON)).resolves.toEqual(cached);
  });

  it("paper-text.json for another paper (the PDF was replaced): extracted again and saved", async () => {
    const pdf = new Uint8Array(paperPdf());
    await writeRunFile(LESSON, PAPER_PDF_FILE, pdf);
    await writeRunJson(LESSON, PAPER_TEXT_FILE, {
      pdfSha256: "0".repeat(64),
      pages: ["stale"],
    });
    const pages = await readPaperPages(LESSON);
    expect(pages).toEqual(PAPER_PAGES.map((lines) => lines.join("")));
    await expect(
      readRunJson(LESSON, PAPER_TEXT_FILE, PaperText),
    ).resolves.toEqual({ pdfSha256: sha256(pdf), pages });
  });

  it("a damaged paper-text.json: logged, extracted again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeRunFile(LESSON, PAPER_PDF_FILE, new Uint8Array(paperPdf()));
    await writeRunFile(LESSON, PAPER_TEXT_FILE, "{ not json");
    await expect(readPaperPages(LESSON)).resolves.toEqual(
      PAPER_PAGES.map((lines) => lines.join("")),
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("PDF text extraction fails: undefined, with a log line naming the lesson", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await writeRunFile(
      LESSON,
      PAPER_PDF_FILE,
      new TextEncoder().encode("not a pdf"),
    );
    await expect(readPaperPages(LESSON)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain(LESSON);
    expect(error.mock.calls[0][0]).toContain("no paper quotes");
  });

  it("a paper with no text at all (a scan): undefined, so no quotes are asked for", async () => {
    await writeRunFile(LESSON, PAPER_PDF_FILE, makePdf({ pages: 2 }));
    await expect(readPaperPages(LESSON)).resolves.toBeUndefined();
  });
});
