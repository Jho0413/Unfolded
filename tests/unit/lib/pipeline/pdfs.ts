// PDFs for tests (ROADMAP L1), written as text: a catalog, a page tree and `pages` page
// objects, optionally with an /Encrypt entry in the trailer. Enough for lib/pipeline/pdf.ts's
// checks; real Claude is never sent these.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function makePdf({
  pages = 1,
  encrypted = false,
}: { pages?: number; encrypted?: boolean } = {}): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(
    " ",
  );
  const pageObjects = Array.from(
    { length: pages },
    (_, i) =>
      `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj`,
  ).join("\n");
  const text = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj`,
    pageObjects,
    `trailer\n<< /Root 1 0 R${encrypted ? " /Encrypt 99 0 R" : ""} >>`,
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(text);
}

/** Writes each PDF to a fresh temp folder and reads it back, as an upload would arrive. */
export async function viaTempDir(
  files: Record<string, Uint8Array>,
): Promise<Record<string, Uint8Array>> {
  const dir = await mkdtemp(path.join(tmpdir(), "l1-pdfs-"));
  const out: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(dir, name);
    await writeFile(file, bytes);
    out[name] = new Uint8Array(await readFile(file));
  }
  return out;
}
