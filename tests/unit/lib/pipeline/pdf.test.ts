// lib/pipeline/pdf.ts (ROADMAP L1, ARCHITECTURE.md sections 5.1 and 7): the byte checks
// before upload. One test per input, plus properties over random bytes.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pdfProblem } from "@/lib/pipeline/pdf";
import { makePdf } from "./pdfs";

const LIMITS = { maxBytes: 1024 * 1024, maxPages: 600 };
const enc = (s: string) => new TextEncoder().encode(s);

describe("pdfProblem", () => {
  const cases: [string, Uint8Array, ReturnType<typeof pdfProblem>][] = [
    ["a tiny valid PDF", makePdf(), undefined],
    ["empty bytes", new Uint8Array(), "not-pdf"],
    ["text that isn't a PDF", enc("hello, not a pdf"), "not-pdf"],
    [
      "a PNG",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "not-pdf",
    ],
    [
      "the header after 1023 bytes of junk (still in the window)",
      enc(`${" ".repeat(1023)}%PDF-1.7`),
      undefined,
    ],
    [
      "the header after 1024 bytes of junk (outside the window)",
      enc(`${" ".repeat(1024)}%PDF-1.7`),
      "not-pdf",
    ],
    ["an encrypted PDF", makePdf({ encrypted: true }), "encrypted"],
    ["exactly maxPages pages", makePdf({ pages: 600 }), undefined],
    ["over maxPages pages", makePdf({ pages: 601 }), "too-many-pages"],
    [
      "/Type /Pages alone isn't counted as a page",
      enc("%PDF-1.4 /Type /Pages /Type/Pages"),
      undefined,
    ],
    [
      "/Type/Page with no space is counted",
      enc(`%PDF-1.4 ${"/Type/Page ".repeat(601)}`),
      "too-many-pages",
    ],
    [
      "/EncryptMetadata alone isn't encryption",
      enc("%PDF-1.4 /EncryptMetadata false"),
      undefined,
    ],
  ];
  for (const [name, bytes, want] of cases)
    it(`${name}: ${want ?? "passes"}`, () => {
      expect(pdfProblem(bytes, LIMITS)).toBe(want);
    });

  it("over maxBytes: too-large", () => {
    const big = new Uint8Array(LIMITS.maxBytes + 1);
    big.set(enc("%PDF-1.4"));
    expect(pdfProblem(big, LIMITS)).toBe("too-large");
  });

  it("exactly maxBytes: passes", () => {
    const exact = new Uint8Array(LIMITS.maxBytes);
    exact.set(enc("%PDF-1.4"));
    expect(pdfProblem(exact, LIMITS)).toBeUndefined();
  });

  it("a big file that isn't a PDF says not-pdf, not too-large", () => {
    expect(pdfProblem(new Uint8Array(LIMITS.maxBytes + 1), LIMITS)).toBe(
      "not-pdf",
    );
  });

  it("property: bytes with no header in the window are never accepted", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) => {
        const head = Buffer.from(bytes.subarray(0, 1028)).toString("latin1");
        fc.pre(!head.includes("%PDF-"));
        expect(pdfProblem(bytes, LIMITS)).toBe("not-pdf");
      }),
    );
  });

  it("property: any bytes after a header give one of the known answers, never a throw", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (tail) => {
        const bytes = new Uint8Array([...enc("%PDF-1.4\n"), ...tail]);
        expect([undefined, "encrypted", "too-many-pages"]).toContain(
          pdfProblem(bytes, LIMITS),
        );
      }),
    );
  });
});
