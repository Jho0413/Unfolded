// A small text PDF for the paper viewer tests (issue #98), made on the fly like the silent
// MP3 in ./savedRun.ts, so no binary is committed. Each page is lines of Helvetica text, top
// down; pdf.js gives one text item per line (hasEOL), as for a real paper.

/** The fixture paper's pages, line by line. */
export const PAPER_PAGES: readonly (readonly string[])[] = [
  [
    "Matrix Multiplication by Hand",
    "Abstract. We show how to multiply two matrices one entry at a time.",
    "Each entry needs only a row, a column and a sum.",
  ],
  [
    "1 Method",
    "To multiply A by B, take a row of A and a column of B.",
    "Pair their entries and multiply each pair. The products of the paired",
    "entries are add-",
    "ed together to give one entry of the product.",
    "In short, every output cell is a row times a column.",
  ],
  ...[3, 4].map((n) => filler(n, 36)),
  // A passage at the foot of a later page: scrolled to while the pane widens.
  [
    ...filler(5, 34),
    "Deep down the paper, the scaled scores are what the softmax sees.",
  ],
];

/** Page n of filler text: `lines` numbered lines. */
function filler(n: number, lines: number): string[] {
  return Array.from(
    { length: lines },
    (_, i) =>
      `Page ${n}, line ${i + 1}: more words about rows, columns and sums.`,
  );
}

/** Escapes a PDF literal string. */
const literal = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function paperPdf(
  pages: readonly (readonly string[])[] = PAPER_PAGES,
): Buffer {
  // 1 catalog, 2 pages, 3 font, then a page and its content per page.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  pages.forEach((lines, i) => {
    const content = [
      "BT /F1 14 Tf 18 TL 72 720 Td",
      ...lines.map((line) => `(${literal(line)}) Tj T*`),
      "ET",
    ].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    );
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
